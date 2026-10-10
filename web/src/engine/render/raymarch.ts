import {
  Break,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
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
  positionWorld,
  pow,
  screenUV,
  sqrt,
  texture,
  uniform,
  uniformArray,
  vec3,
  vec4,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { SdfTree } from '../../protocol'
import { createEvaluator } from '../organic/evaluate'
import { compileScene, MAX_BOUND, structureKey, type SdfGraph } from '../organic/graph'
import type { PickTarget } from '../organic/pick'
import { buildDistanceFn, createParamArray, readParam, writeParams } from '../organic/tslCodegen'

/** Sphere-tracing steps are shortened a little, because smooth blends make distances approximate. */
const STEP_FACTOR = 0.9
/** A ray counts as a hit when the surface is nearer than this fraction of the distance travelled. */
const HIT_FRACTION = 0.0007
const MIN_HIT_DISTANCE = 0.002 // mm
const CLAY = [0.78, 0.76, 0.73] as const
const SELECTED_CLAY = [0.86, 0.71, 0.5] as const
/** Shaders kept after their object stops using them, so undo and redo do not rebuild. */
const MAX_SPARE_SHADERS = 8
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
/** Every object is drawn through the back faces of a cube around its bounding sphere. */
const PROXY = new THREE.BoxGeometry(2, 2, 2)

export interface RaymarchQuality {
  /** Resolution relative to the canvas. */
  scale: number
  maxSteps: number
}

export interface RaymarchObject {
  readonly id: string
  readonly tree: SdfTree
}

export interface RaymarchPass {
  /** Full-screen layers for the main scene: they copy the SDF images and their depth into the frame. */
  readonly composite: THREE.Object3D
  /**
   * Sets what to draw. Each object has its own shader, rebuilt only when that object's structure
   * changes. The active object is redrawn every frame; the rest are redrawn only when they or the
   * view change, and reused otherwise.
   */
  setObjects(objects: readonly RaymarchObject[], activeId: string | null): void
  /** Fades the shapes towards the background, for when they belong to the other mode. */
  setDimmed(dimmed: boolean): void
  /** Call when the camera has moved, so the reused image of inactive objects is redrawn. */
  viewChanged(): void
  render(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    quality: RaymarchQuality,
  ): void
  pickTargets(): PickTarget[]
  summary(): { objects: number; nodes: number; params: number }
  readonly builds: number
  /** Time the newest shader builds took, from first use to the first finished frame. */
  readonly lastBuildMs: number | null
  readonly gpuBytes: number
  dispose(): void
}

interface Shader {
  key: string
  material: THREE.Material
  params: THREE.Vector4[]
  selected: { value: number }
}

interface Entry {
  tree: SdfTree
  graph: SdfGraph
  shader: Shader
  mesh: THREE.Mesh
  unbounded: boolean
  pick?: PickTarget
}

/** One colour-and-depth image of some of the objects, plus the layer that copies it into the frame. */
interface Layer {
  target: THREE.RenderTarget
  scene: THREE.Scene
  composite: THREE.Mesh
  dirty: boolean
}

/**
 * Draws Organic objects by sphere tracing. Each object is marched inside its own bounding box
 * into a shared colour and depth image, where the depth test joins them; a composite layer then
 * copies the image into the main frame. Writing real depth is what lets meshes, the grid and
 * gizmos intersect SDF shapes correctly.
 */
export function createRaymarchPass(
  renderer: THREE.WebGPURenderer,
  background: number,
): RaymarchPass {
  const maxSteps = uniform(96, 'int')
  const strength = uniform(1)

  const makeLayer = (order: number): Layer => {
    const target = new THREE.RenderTarget(1, 1, { depthBuffer: true })
    // Stored as sRGB so eight bits per channel do not band in the shadows.
    target.texture.colorSpace = THREE.SRGBColorSpace
    target.depthTexture = new THREE.DepthTexture(1, 1)
    target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter
    const composite = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      compositeMaterial(target, strength, background),
    )
    composite.frustumCulled = false
    composite.renderOrder = order // Before everything else, so the rest depth-tests against it.
    composite.visible = false
    return { target, scene: new THREE.Scene(), composite, dirty: true }
  }
  /** Inactive objects: redrawn only when they or the view change. */
  const still = makeLayer(-1000)
  /** The object being edited: redrawn every frame. */
  const live = makeLayer(-999)
  const composite = new THREE.Group()
  composite.add(still.composite, live.composite)

  const entries = new Map<string, Entry>()
  const spare: Shader[] = []
  let builds = 0
  let lastBuildMs: number | null = null
  let timeBuild = false
  let lastSize = ''

  function build(graph: SdfGraph, key: string): Shader {
    const array = createParamArray(graph)
    const distance = buildDistanceFn(graph, array.node)
    const selected = uniform(0)

    const march = Fn(() => {
      const origin = cameraPosition
      const direction = normalize(positionWorld.sub(cameraPosition)).toVar()

      // Only the stretch of the ray inside the object's bounding sphere is marched.
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
      const position = vec4(origin.add(direction.mul(t)), 1)
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(position)
      return vec4(normalize(gradient), clip.z.div(clip.w))
    })

    // World normal and depth of the surface under this pixel. Shared by the colour and depth
    // outputs, so the march runs once.
    const surface = march().toVar()

    const shade = Fn(() => {
      // Lit in view space, so the studio lights follow the camera and shapes always read clearly.
      const n = normalize(cameraViewMatrix.mul(vec4(surface.xyz, 0)).xyz).toVar()
      const keyLight = max(dot(n, normalize(vec3(0.45, 0.6, 0.66))), 0)
      const fill = max(dot(n, normalize(vec3(-0.7, 0.1, 0.5))), 0)
      const rim = pow(float(1).sub(clamp(n.z, 0, 1)), 3)
      const ambient = mix(float(0.1), float(0.3), n.y.mul(0.5).add(0.5))
      const highlight = pow(max(dot(n, normalize(vec3(0.3, 0.45, 0.84))), 0), 48)
      const light = ambient.add(keyLight.mul(0.85)).add(fill.mul(0.2)).add(rim.mul(0.12))
      const clay = mix(vec3(...CLAY), vec3(...SELECTED_CLAY), selected)
      return vec4(clay.mul(light).add(highlight.mul(0.18)), 1)
    })

    const material = new THREE.MeshBasicNodeMaterial()
    material.colorNode = shade()
    material.depthNode = surface.w
    material.side = THREE.BackSide
    builds += 1
    timeBuild = true
    return { key, material, params: array.vectors, selected }
  }

  function retire(shader: Shader): void {
    spare.push(shader)
    if (spare.length > MAX_SPARE_SHADERS) spare.shift()!.material.dispose()
  }

  function shaderFor(graph: SdfGraph, key: string): Shader {
    const index = spare.findIndex((shader) => shader.key === key)
    return index >= 0 ? spare.splice(index, 1)[0]! : build(graph, key)
  }

  const layerOf = (mesh: THREE.Mesh): Layer | undefined =>
    mesh.parent === still.scene ? still : mesh.parent === live.scene ? live : undefined

  return {
    composite,
    setDimmed(dimmed) {
      strength.value = dimmed ? DIMMED_STRENGTH : 1
    },
    viewChanged() {
      still.dirty = true
    },
    setObjects(objects, activeId) {
      const present = new Set<string>()
      for (const { id, tree } of objects) {
        present.add(id)
        const layer = id === activeId ? live : still
        let entry = entries.get(id)
        if (!entry || entry.tree !== tree) {
          const graph = compileScene([tree])
          const key = structureKey(graph)
          let shader = entry?.shader
          if (shader?.key !== key) {
            if (shader) retire(shader)
            shader = shaderFor(graph, key)
          }
          writeParams(graph, shader.params)
          const mesh = entry?.mesh ?? new THREE.Mesh(PROXY, shader.material)
          mesh.material = shader.material
          const [x, y, z, radius] = graph.params.slice(graph.sceneBound, graph.sceneBound + 4)
          const unbounded = radius! >= MAX_BOUND
          mesh.position.set(x!, y!, z!)
          mesh.scale.setScalar(radius!)
          mesh.frustumCulled = !unbounded
          entry = { tree, graph, shader, mesh, unbounded }
          entries.set(id, entry)
          layer.dirty = true
        }
        if (entry.mesh.parent !== layer.scene) {
          const from = layerOf(entry.mesh)
          if (from) from.dirty = true
          layer.scene.add(entry.mesh)
          layer.dirty = true
        }
        entry.shader.selected.value = id === activeId ? 1 : 0
      }
      for (const [id, entry] of entries) {
        if (present.has(id)) continue
        const from = layerOf(entry.mesh)
        if (from) from.dirty = true
        entry.mesh.removeFromParent()
        retire(entry.shader)
        entries.delete(id)
      }
      still.composite.visible = still.scene.children.length > 0
      live.composite.visible = live.scene.children.length > 0
    },
    render(camera, width, height, quality) {
      const ratio = renderer.getPixelRatio() * quality.scale
      const w = Math.max(1, Math.round(width * ratio))
      const h = Math.max(1, Math.round(height * ratio))
      const size = `${w}x${h}@${quality.maxSteps}`
      if (size !== lastSize) {
        lastSize = size
        still.target.setSize(w, h)
        live.target.setSize(w, h)
        still.dirty = true
      }
      maxSteps.value = quality.maxSteps
      // A shape with no finite bound is drawn through a box that always surrounds the camera.
      for (const entry of entries.values()) {
        if (!entry.unbounded) continue
        entry.mesh.position.copy(camera.position)
        entry.mesh.scale.setScalar(camera.far * 0.5)
      }

      const started = performance.now()
      if (still.dirty && still.composite.visible) {
        renderer.setRenderTarget(still.target)
        renderer.render(still.scene, camera)
      }
      still.dirty = false
      if (live.composite.visible) {
        renderer.setRenderTarget(live.target)
        renderer.render(live.scene, camera)
      }
      renderer.setRenderTarget(null)
      if (timeBuild) {
        timeBuild = false
        void gpuIdle(renderer).then(() => (lastBuildMs = performance.now() - started))
      }
    },
    pickTargets() {
      return [...entries].map(([id, entry]) => {
        entry.pick ??= { id, graph: entry.graph, evaluate: createEvaluator(entry.graph) }
        return entry.pick
      })
    },
    summary() {
      let nodes = 0
      let params = 0
      for (const { graph } of entries.values()) {
        nodes += graph.nodes.length
        params += graph.params.length
      }
      return { objects: entries.size, nodes, params }
    },
    get builds() {
      return builds
    },
    get lastBuildMs() {
      return lastBuildMs
    },
    get gpuBytes() {
      // Eight-bit colour plus depth, four bytes each, for every layer in use.
      const pixels = (layer: Layer) =>
        layer.composite.visible ? layer.target.width * layer.target.height : 0
      return (pixels(still) + pixels(live)) * 8
    },
    dispose() {
      for (const entry of entries.values()) entry.shader.material.dispose()
      for (const shader of spare) shader.material.dispose()
      for (const layer of [still, live]) {
        layer.target.dispose()
        layer.composite.geometry.dispose()
        ;(layer.composite.material as THREE.Material).dispose()
      }
    },
  }
}

/** Copies an SDF image into the main frame and writes its depth, skipping pixels the rays missed. */
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
  material.side = THREE.DoubleSide
  return material
}

/** Resolves once the GPU has finished everything submitted so far. */
export async function gpuIdle(renderer: THREE.WebGPURenderer): Promise<void> {
  const device = (renderer.backend as { device?: GPUDevice }).device
  await device?.queue.onSubmittedWorkDone()
}
