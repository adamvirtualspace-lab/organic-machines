import * as THREE from 'three/webgpu'
import type { ViewportHost, ViewportSupport } from '../../protocol'
import type { Engine } from '../engine'
import { createAxisGizmo } from './axisGizmo'
import { createCameraControls } from './cameraControls'
import { createGrid } from './grid'

const BACKGROUND = 0x17191d
const HOME_POSITION = new THREE.Vector3(260, -340, 240) // mm, looking at the origin
const MAX_PIXEL_RATIO = 2
const MSAA_SAMPLES = 4

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
  if (!adapter)
    return { ok: false, reason: 'WebGPU is available, but no graphics adapter was found.' }
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
  camera.up.set(0, 0, 1) // CAD convention: Z is up.
  camera.position.copy(HOME_POSITION)

  const grid = createGrid()
  const gizmo = createAxisGizmo()
  scene.add(grid.object, gizmo.object)

  const navigation = createCameraControls(camera, canvas, (command) => {
    if (command === 'home') void engine.execute({ name: 'view.home', params: {} })
    else if (command === 'flip') void engine.execute({ name: 'view.flip', params: {} })
    else void engine.execute({ name: 'view.set', params: command })
  })
  const controls = navigation.orbit

  let width = 1
  let height = 1
  let frameMs: number | null = null
  let frame = 0

  // Render on demand: nothing is drawn while the view is idle, which saves battery and heat.
  const invalidate = () => {
    frame ||= requestAnimationFrame(render)
  }

  function render(): void {
    frame = 0
    const started = performance.now()
    const distance = camera.position.distanceTo(controls.target)
    camera.near = distance / 100
    camera.far = distance * 100
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld() // The gizmo unprojects through the camera before the renderer updates it.
    grid.update(controls.target, distance)
    gizmo.update(camera, width, height)
    renderer.render(scene, camera)
    frameMs = performance.now() - started
  }

  const resize = new ResizeObserver(() => {
    width = Math.max(container.clientWidth, 1)
    height = Math.max(container.clientHeight, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    renderer.setSize(width, height)
    camera.aspect = width / height
    invalidate()
  })
  resize.observe(container)
  controls.addEventListener('change', invalidate)

  const detachView = engine.attachView({
    home() {
      camera.position.copy(HOME_POSITION)
      controls.target.set(0, 0, 0)
      controls.update()
      invalidate()
    },
    setView: navigation.setView,
    flipView: navigation.flipView,
    stats: () => ({
      frameMs,
      gpuBytesEstimate: estimateGpuBytes(scene, width, height, renderer.getPixelRatio()),
    }),
  })

  return () => {
    detachView()
    cancelAnimationFrame(frame)
    resize.disconnect()
    navigation.dispose()
    renderer.dispose()
    canvas.remove()
  }
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
