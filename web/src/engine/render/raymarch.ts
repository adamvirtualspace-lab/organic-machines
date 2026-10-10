import {
  Break,
  clamp,
  color,
  Discard,
  dot,
  float,
  Fn,
  If,
  int,
  Loop,
  max,
  mix,
  normalize,
  positionGeometry,
  pow,
  screenUV,
  sqrt,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import { structureKey, type SdfGraph } from '../organic/graph'
import { buildDistanceFn, createParamArray, readParam, writeParams } from '../organic/tslCodegen'

/** Sphere-tracing steps are shortened a little, because smooth blends make distances approximate. */
const STEP_FACTOR = 0.9
/** A ray counts as a hit when the surface is nearer than this fraction of the distance travelled. */
const HIT_FRACTION = 0.0007
const MIN_HIT_DISTANCE = 0.002 // mm
const CLAY = [0.78, 0.76, 0.73] as const
const MAX_BUILT_SHADERS = 6
const DIMMED_STRENGTH = 0.35
/** Entry 0 is "no offset"; the other four are the corners used to read the surface gradient. */
const TETRAHEDRON = uniformArray<'vec3'>(
  [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(1, 1, 1),
  ],
  'vec3',
)

export interface RaymarchQuality {
  /** Resolution relative to the canvas. */
  scale: number
  maxSteps: number
}

export interface RaymarchPass {
  /** A full-screen layer for the main scene: it copies the SDF image and its depth into the frame. */
  readonly composite: THREE.Mesh
  /** Pass null when there is nothing to draw. Rebuilds the shader only if the structure changed. */
  setGraph(graph: SdfGraph | null): void
  /** Fades the shapes towards the background, for when they belong to the other mode. */
  setDimmed(dimmed: boolean): void
  render(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    quality: RaymarchQuality,
  ): void
  readonly builds: number
  /** Resolves with the time the newest shader took from first use to its first finished frame. */
  readonly lastBuildMs: number | null
  readonly gpuBytes: number
  dispose(): void
}

/**
 * Draws the Organic scene by sphere tracing into its own colour and depth target, which the
 * composite layer then copies into the main frame. Writing real depth is what lets meshes,
 * the grid and gizmos intersect SDF shapes correctly.
 */
export function createRaymarchPass(
  renderer: THREE.WebGPURenderer,
  background: number,
): RaymarchPass {
  const strength = uniform(1)
  const target = new THREE.RenderTarget(1, 1, { depthBuffer: true })
  // Stored as sRGB so eight bits per channel do not band in the shadows.
  target.texture.colorSpace = THREE.SRGBColorSpace
  target.depthTexture = new THREE.DepthTexture(1, 1)
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter

  // The quad is drawn with its own camera, so the real camera's matrices are passed in by hand.
  const inverseViewProjection = uniform(new THREE.Matrix4())
  const viewProjection = uniform(new THREE.Matrix4())
  const viewMatrix = uniform(new THREE.Matrix4())
  const maxSteps = uniform(96, 'int')

  const quad = new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial())
  const composite = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    compositeMaterial(target, strength, background),
  )
  composite.frustumCulled = false
  composite.renderOrder = -1000 // First, so everything else depth-tests against it.
  composite.visible = false

  // Recently used shaders, newest last. Undo and redo flip between structures the user has
  // already seen, so keeping a few built ones makes those instant.
  const built = new Map<string, { material: THREE.Material; params: THREE.Vector4[] }>()
  let key: string | null = null
  let params: THREE.Vector4[] = []
  let builds = 0
  let lastBuildMs: number | null = null
  let timeBuild = false

  function build(graph: SdfGraph): { material: THREE.Material; params: THREE.Vector4[] } {
    const array = createParamArray(graph)
    const distance = buildDistanceFn(graph, array.node)

    const march = Fn(() => {
      const ndc = vec2(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y.mul(2)))
      const near = inverseViewProjection.mul(vec4(ndc, 0, 1))
      const far = inverseViewProjection.mul(vec4(ndc, 1, 1))
      const origin = near.xyz.div(near.w).toVar()
      const direction = normalize(far.xyz.div(far.w).sub(origin)).toVar()

      // Only the stretch of the ray inside the scene's bounding sphere is marched.
      const bound = readParam(array.node, graph.sceneBound, 4)
      const toOrigin = origin.sub(bound.xyz)
      const b = dot(toOrigin, direction)
      const discriminant = b.mul(b).sub(dot(toOrigin, toOrigin).sub(bound.w.mul(bound.w)))
      Discard(discriminant.lessThan(0))
      const reach = sqrt(max(discriminant, 0))
      const t = max(b.negate().sub(reach), 0).toVar()
      const end = b.negate().add(reach)

      // One loop does both jobs: it steps along the ray, then on a hit takes four more
      // readings around the surface for the normal. Keeping `distance` to a single call
      // site matters, because the shader compiler inlines it and compile time follows.
      const hit = float(0).toVar()
      const tap = int(0).toVar() // 0 while stepping, 1 to 4 while reading the gradient.
      const spread = float(0).toVar()
      const gradient = vec3(0).toVar()
      Loop({ start: 0, end: maxSteps.add(4) }, ({ i }) => {
        If(tap.equal(0).and(i.greaterThanEqual(maxSteps)), () => {
          Break()
        })
        const offset = TETRAHEDRON.element(tap)
        // Stored at once: left as an expression, it would first be computed inside a branch below.
        const d = distance(origin.add(direction.mul(t)).add(offset.mul(spread))).toVar()
        If(tap.greaterThan(0), () => {
          gradient.addAssign(offset.mul(d))
          If(tap.equal(4), () => {
            Break()
          })
          tap.addAssign(1)
        })
          .ElseIf(d.lessThan(t.mul(HIT_FRACTION).add(MIN_HIT_DISTANCE)), () => {
            hit.assign(1)
            spread.assign(t.mul(HIT_FRACTION).add(MIN_HIT_DISTANCE).mul(1.5))
            tap.assign(1)
          })
          .Else(() => {
            t.addAssign(d.mul(STEP_FACTOR))
            If(t.greaterThan(end), () => {
              Break()
            })
          })
      })
      Discard(hit.lessThan(0.5))
      const clip = viewProjection.mul(vec4(origin.add(direction.mul(t)), 1))
      return vec4(normalize(gradient), clip.z.div(clip.w))
    })

    // World normal and depth of the surface under this pixel. Shared by the colour and depth
    // outputs, so the march runs once.
    const surface = march().toVar()

    const shade = Fn(() => {
      // Lit in view space, so the studio lights follow the camera and shapes always read clearly.
      const n = normalize(viewMatrix.mul(vec4(surface.xyz, 0)).xyz).toVar()
      const keyLight = max(dot(n, normalize(vec3(0.45, 0.6, 0.66))), 0)
      const fill = max(dot(n, normalize(vec3(-0.7, 0.1, 0.5))), 0)
      const rim = pow(float(1).sub(clamp(n.z, 0, 1)), 3)
      const ambient = mix(float(0.1), float(0.3), n.y.mul(0.5).add(0.5))
      const highlight = pow(max(dot(n, normalize(vec3(0.3, 0.45, 0.84))), 0), 48)
      const light = ambient.add(keyLight.mul(0.85)).add(fill.mul(0.2)).add(rim.mul(0.12))
      return vec4(
        vec3(...CLAY)
          .mul(light)
          .add(highlight.mul(0.18)),
        1,
      )
    })

    const result = new THREE.MeshBasicNodeMaterial()
    result.colorNode = shade()
    result.depthNode = surface.w
    result.depthFunc = THREE.AlwaysDepth
    return { material: result, params: array.vectors }
  }

  return {
    composite,
    setDimmed(dimmed) {
      strength.value = dimmed ? DIMMED_STRENGTH : 1
    },
    setGraph(graph) {
      composite.visible = graph !== null && graph.roots.length > 0
      if (!graph || !composite.visible) return
      const nextKey = structureKey(graph)
      if (nextKey !== key) {
        let entry = built.get(nextKey)
        if (entry) {
          built.delete(nextKey)
        } else {
          entry = build(graph)
          builds += 1
          timeBuild = true
        }
        built.set(nextKey, entry)
        if (built.size > MAX_BUILT_SHADERS) {
          const [oldestKey, oldest] = built.entries().next().value!
          oldest.material.dispose()
          built.delete(oldestKey)
        }
        quad.material = entry.material
        params = entry.params
        key = nextKey
      }
      writeParams(graph, params)
    },
    render(camera, width, height, quality) {
      if (!composite.visible) return
      const ratio = renderer.getPixelRatio() * quality.scale
      target.setSize(
        Math.max(1, Math.round(width * ratio)),
        Math.max(1, Math.round(height * ratio)),
      )
      maxSteps.value = quality.maxSteps
      viewMatrix.value.copy(camera.matrixWorldInverse)
      viewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      inverseViewProjection.value.copy(viewProjection.value).invert()

      const started = performance.now()
      renderer.setRenderTarget(target)
      quad.render(renderer)
      renderer.setRenderTarget(null)
      if (timeBuild) {
        timeBuild = false
        void gpuIdle(renderer).then(() => (lastBuildMs = performance.now() - started))
      }
    },
    get builds() {
      return builds
    },
    get lastBuildMs() {
      return lastBuildMs
    },
    get gpuBytes() {
      // Eight-bit colour plus depth, four bytes each.
      return composite.visible ? target.width * target.height * 8 : 0
    },
    dispose() {
      for (const entry of built.values()) entry.material.dispose()
      target.dispose()
      composite.geometry.dispose()
      ;(composite.material as THREE.Material).dispose()
    },
  }
}

/** Copies the SDF image into the main frame and writes its depth, skipping pixels the rays missed. */
function compositeMaterial(
  target: THREE.RenderTarget,
  strength: THREE.Node<'float'>,
  background: number,
): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial()
  const depth = texture(target.depthTexture!, screenUV).x
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  material.colorNode = Fn(() => {
    Discard(depth.greaterThanEqual(1))
    const shaded = texture(target.texture, screenUV)
    return vec4(mix(color(background), shaded.rgb, strength), 1)
  })()
  material.depthNode = depth
  material.depthFunc = THREE.AlwaysDepth
  material.side = THREE.DoubleSide
  return material
}

/** Resolves once the GPU has finished everything submitted so far. */
export async function gpuIdle(renderer: THREE.WebGPURenderer): Promise<void> {
  const device = (renderer.backend as { device?: GPUDevice }).device
  await device?.queue.onSubmittedWorkDone()
}
