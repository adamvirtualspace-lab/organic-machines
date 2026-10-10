import * as THREE from 'three/webgpu'
import type { LogMessage, SdfTree, ViewportHost, ViewportSupport } from '../../protocol'
import type { Engine, SceneState } from '../engine'
import { placeNode } from '../organic/frames'
import { visibleTree } from '../organic/tree'
import { createAdaptiveScale } from './adaptiveScale'
import { createAxisGizmo } from './axisGizmo'
import { createCameraControls } from './cameraControls'
import { createGrid } from './grid'
import { createMoveGizmo } from './moveGizmo'
import { createRaymarchPass, gpuIdle, type RaymarchQuality } from './raymarch'
import { runSdfSelfTest } from './sdfSelfTest'
import { attachShapeTools } from './shapeTools'

const BACKGROUND = 0x17191d
const HOME_POSITION = new THREE.Vector3(260, -340, 240) // mm, looking at the origin
const MAX_PIXEL_RATIO = 2
const MSAA_SAMPLES = 4

const FULL_QUALITY: RaymarchQuality = { scale: 1, maxSteps: 128 }
/** While the view moves, the SDF pass drops to fewer steps and a lower, self-adjusting resolution. */
const MOVING_STEPS = 64
/** Frame gaps beyond `slowMs` or under `fastMs` move the resolution: roughly 28 and 52 frames a second. */
const MOVING_SCALE = { start: 0.5, min: 0.25, max: 1, step: 0.125, slowMs: 36, fastMs: 19 }
/** How long after the last movement the view waits before redrawing at full quality. */
const SETTLE_MS = 200

/** Creates the viewport side of the engine. Only the browser entry point imports this. */
export function createViewportHost(engine: Engine): ViewportHost {
  return {
    checkSupport,
    attach(container) {
      let dispose: (() => void) | undefined
      let cancelled = false
      void start(engine, container).then((stop) => {
        if (cancelled) stop()
        else dispose = stop
      })
      return () => {
        cancelled = true
        dispose?.()
      }
    },
  }
}

async function checkSupport(): Promise<ViewportSupport> {
  if (!('gpu' in navigator)) {
    const reason = window.isSecureContext
      ? 'This browser does not support WebGPU.'
      : 'WebGPU needs a secure page. Open the app over https or on localhost.'
    return { ok: false, reason }
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    return { ok: false, reason: 'WebGPU is available, but no graphics adapter was found.' }
  }
  return { ok: true }
}

async function start(engine: Engine, container: HTMLElement): Promise<() => void> {
  const renderer = new THREE.WebGPURenderer({ antialias: true, samples: MSAA_SAMPLES })
  renderer.setClearColor(BACKGROUND)
  const canvas = renderer.domElement
  canvas.style.display = 'block'
  container.append(canvas)
  await renderer.init()

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 10_000)
  // Set up front so matrices read before the first render already use WebGPU's depth range.
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem
  camera.up.set(0, 0, 1) // CAD convention: Z is up.
  camera.position.copy(HOME_POSITION)

  const grid = createGrid()
  const axes = createAxisGizmo()
  const mover = createMoveGizmo()
  const raymarch = createRaymarchPass(renderer, BACKGROUND)
  scene.add(raymarch.composite, grid.object, axes.object, mover.object)

  let width = 1
  let height = 1

  // Created before the camera controls so a press on a gizmo arrow is claimed first.
  const tools = attachShapeTools({
    canvas,
    camera,
    gizmo: mover,
    size: () => ({ width, height }),
    execute: (command) => void engine.execute(command),
    setNavigation: (enabled) => (controls.enabled = enabled),
    pickTargets: () => raymarch.pickTargets(),
  })
  const navigation = createCameraControls(camera, canvas, (command) => {
    if (command === 'home') void engine.execute({ name: 'view.home', params: {} })
    else if (command === 'flip') void engine.execute({ name: 'view.flip', params: {} })
    else void engine.execute({ name: 'view.set', params: command })
  })
  const controls = navigation.orbit

  let frameMs: number | null = null
  let frame = 0
  let moving = false
  let settleTimer = 0
  let hasShapes = false
  const movingScale = createAdaptiveScale(MOVING_SCALE)
  /** Hidden nodes are filtered out once per tree, so an unchanged object keeps the same identity. */
  const drawn = new WeakMap<SdfTree, SdfTree | null>()

  // Render on demand: nothing is drawn while the view is idle, which saves battery and heat.
  const invalidate = () => {
    frame ||= requestAnimationFrame(render)
  }

  function drawFrame(quality: RaymarchQuality): void {
    const distance = camera.position.distanceTo(controls.target)
    camera.near = distance / 100
    camera.far = distance * 100
    camera.updateProjectionMatrix()
    // The gizmos read the camera before the renderer updates it.
    camera.updateMatrixWorld()
    grid.update(controls.target, distance)
    axes.update(camera, width, height)
    mover.update(camera, height)
    raymarch.render(camera, width, height, quality)
    renderer.render(scene, camera)
  }

  function render(): void {
    frame = 0
    const started = performance.now()
    drawFrame(moving ? { scale: movingScale.frame(started), maxSteps: MOVING_STEPS } : FULL_QUALITY)
    void gpuIdle(renderer).then(() => (frameMs = performance.now() - started))
  }

  const onViewChange = () => {
    raymarch.viewChanged()
    invalidate()
  }
  const onMoveStart = () => {
    clearTimeout(settleTimer)
    moving = true
  }
  const onMoveEnd = () => {
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      moving = false
      invalidate()
    }, SETTLE_MS)
  }

  const resize = new ResizeObserver(() => {
    width = Math.max(container.clientWidth, 1)
    height = Math.max(container.clientHeight, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    renderer.setSize(width, height)
    camera.aspect = width / height
    onViewChange()
  })
  resize.observe(container)
  controls.addEventListener('change', onViewChange)
  controls.addEventListener('start', onMoveStart)
  controls.addEventListener('end', onMoveEnd)

  function sceneChanged({ doc, mode, selection }: SceneState): void {
    const editing = mode === 'organic'
    const objects = doc.objects.flatMap(({ id, sdf }) => {
      if (!sdf) return []
      if (!drawn.has(sdf)) drawn.set(sdf, visibleTree(sdf) ?? null)
      const tree = drawn.get(sdf)
      return tree ? [{ id, tree }] : []
    })
    hasShapes = objects.length > 0
    raymarch.setObjects(objects, editing ? (selection?.object ?? null) : null)
    // Organic shapes stay visible in Machines mode, but dimmed to show they are locked.
    raymarch.setDimmed(!editing)

    const selected = selection && doc.objects.find((object) => object.id === selection.object)
    const node = selected?.sdf && selection?.node ? selection.node : undefined
    const placement = (editing && node && placeNode(selected!.sdf!, node)) || null
    mover.setPlacement(placement)
    tools.setTarget({
      selection,
      placement,
      value: node ? findPosition(selected!.sdf!, node) : null,
      enabled: editing,
    })
    invalidate()
  }

  /** Times frames while circling the scene, waiting for the GPU each time so vsync does not cap the result. */
  async function bench(): Promise<LogMessage[]> {
    const savedPosition = camera.position.clone()
    const up = new THREE.Vector3(0, 0, 1)
    const offset = new THREE.Vector3()
    const ratio = renderer.getPixelRatio()
    const pixels = `${Math.round(width * ratio)}×${Math.round(height * ratio)} px`
    const { objects, nodes, params } = raymarch.summary()
    const runs: [string, RaymarchQuality][] = [
      ['Full quality', FULL_QUALITY],
      ['While moving', { scale: MOVING_SCALE.start, maxSteps: MOVING_STEPS }],
    ]
    const messages: LogMessage[] = [
      {
        kind: 'info',
        text: `Scene: ${objects} objects, ${nodes} graph nodes, ${params} parameters, canvas ${pixels}`,
      },
    ]
    for (const [label, quality] of runs) {
      const times: number[] = []
      for (let i = 0; i < 43; i++) {
        offset.subVectors(camera.position, controls.target)
        offset.applyAxisAngle(up, THREE.MathUtils.degToRad(3))
        camera.position.copy(controls.target).add(offset)
        camera.lookAt(controls.target)
        raymarch.viewChanged()
        const started = performance.now()
        drawFrame(quality)
        await gpuIdle(renderer)
        if (i >= 3) times.push(performance.now() - started) // The first frames warm up.
      }
      times.sort((a, b) => a - b)
      const median = times[Math.floor(times.length / 2)]!
      const slow = times[Math.floor(times.length * 0.95)]!
      messages.push({
        kind: 'info',
        text: `${label} (scale ${quality.scale}, ${quality.maxSteps} steps): median ${median.toFixed(1)} ms = ${(1000 / median).toFixed(0)} fps, slowest 5% ${slow.toFixed(1)} ms`,
      })
    }
    if (raymarch.lastBuildMs !== null) {
      messages.push({
        kind: 'info',
        text: `Shaders built ${raymarch.builds} time(s); the last build took ${raymarch.lastBuildMs.toFixed(0)} ms to its first frame`,
      })
    }
    camera.position.copy(savedPosition)
    controls.update()
    onViewChange()
    return messages
  }

  const detachView = engine.attachView({
    home() {
      camera.position.copy(HOME_POSITION)
      controls.target.set(0, 0, 0)
      controls.update()
      onViewChange()
    },
    setView: navigation.setView,
    flipView: navigation.flipView,
    sceneChanged,
    bench,
    selfTest: () => runSdfSelfTest(renderer),
    stats: () => ({
      frameMs,
      gpuBytesEstimate:
        estimateGpuBytes(scene, width, height, renderer.getPixelRatio()) + raymarch.gpuBytes,
      sdfScale: hasShapes ? (moving ? movingScale.value : FULL_QUALITY.scale) : null,
      shaderBuilds: raymarch.builds,
      shaderBuildMs: raymarch.lastBuildMs,
    }),
  })

  return () => {
    detachView()
    cancelAnimationFrame(frame)
    clearTimeout(settleTimer)
    resize.disconnect()
    tools.dispose()
    navigation.dispose()
    raymarch.dispose()
    renderer.dispose()
    canvas.remove()
  }
}

function findPosition(tree: SdfTree, id: string): readonly number[] | null {
  if (tree.id === id) return tree.position
  const children = 'children' in tree ? tree.children : 'child' in tree ? [tree.child] : []
  for (const child of children) {
    const found = findPosition(child, id)
    if (found) return found
  }
  return null
}

/**
 * A rough figure, since WebGPU reports no memory use: the swap chain, the multisampled colour
 * and depth targets, and every vertex and index buffer in the scene.
 */
function estimateGpuBytes(
  scene: THREE.Scene,
  width: number,
  height: number,
  ratio: number,
): number {
  const pixels = width * ratio * height * ratio
  let bytes = pixels * 4 * (1 + 2 * MSAA_SAMPLES)
  const seen = new Set<THREE.BufferGeometry>()
  scene.traverse((node) => {
    const geometry = (node as Partial<THREE.Mesh>).geometry
    if (!geometry || seen.has(geometry)) return
    seen.add(geometry)
    for (const attribute of Object.values(geometry.attributes)) {
      bytes += attribute.array.byteLength
    }
    bytes += geometry.index?.array.byteLength ?? 0
  })
  return bytes
}
