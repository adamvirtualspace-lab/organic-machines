import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import type { ViewName } from '../../protocol'

/** Unit vectors from the target towards the camera. Top and bottom lean a hair off the pole so "up" stays defined. */
const VIEW_DIRECTIONS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, -1e-4, 1).normalize(),
  bottom: new THREE.Vector3(0, -1e-4, -1).normalize(),
}

const NUMPAD_VIEWS: Record<string, [plain: ViewName, withCtrl: ViewName]> = {
  Numpad1: ['front', 'back'],
  Numpad3: ['right', 'left'],
  Numpad7: ['top', 'bottom'],
}

export interface CameraControls {
  readonly orbit: OrbitControls
  setView(view: ViewName): void
  /** Swings the camera to the opposite side of the target (Blender's numpad 9). */
  flipView(): void
  dispose(): void
}

/**
 * Blender-style navigation on top of OrbitControls (turntable, Z up):
 * middle-drag orbits, Shift+middle-drag pans, Ctrl+middle-drag or the wheel zooms.
 * Alt+left-drag stands in for the middle button on laptops, as Blender's "Emulate 3 Button Mouse" does.
 * Left and right buttons are otherwise left free for tools. Touch: one finger orbits, two pan and zoom.
 */
export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  onKeyCommand: (command: { view: ViewName } | 'flip' | 'home') => void,
): CameraControls {
  // Registered before OrbitControls adds its own listener, so the mapping is set first.
  const mapButtons = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    // OrbitControls itself turns Shift+ROTATE into a pan.
    const action = event.ctrlKey || event.metaKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE
    orbit.mouseButtons = { LEFT: event.altKey ? action : null, MIDDLE: action, RIGHT: null }
  }
  // Stops the browser's middle-click autoscroll from grabbing the drag.
  const blockAutoscroll = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault()
  }
  canvas.addEventListener('pointerdown', mapButtons)
  canvas.addEventListener('mousedown', blockAutoscroll)

  const orbit = new OrbitControls(camera, canvas)
  orbit.minDistance = 1
  orbit.maxDistance = 50_000
  orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null }
  orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }

  // Like Blender, view keys apply to the viewport the pointer is over.
  let hovered = false
  const enter = () => (hovered = true)
  const leave = () => (hovered = false)
  const onKey = (event: KeyboardEvent) => {
    if (!hovered || isTyping(event.target)) return
    const views = NUMPAD_VIEWS[event.code]
    if (views) onKeyCommand({ view: views[event.ctrlKey ? 1 : 0] })
    else if (event.code === 'Numpad9') onKeyCommand('flip')
    else if (event.code === 'Home') onKeyCommand('home')
    else return
    event.preventDefault()
  }
  canvas.addEventListener('pointerenter', enter)
  canvas.addEventListener('pointerleave', leave)
  window.addEventListener('keydown', onKey)

  const offset = new THREE.Vector3()
  const place = (direction: THREE.Vector3) => {
    const distance = camera.position.distanceTo(orbit.target)
    camera.position.copy(orbit.target).addScaledVector(direction, distance)
    orbit.update()
  }

  return {
    orbit,
    setView: (view) => place(VIEW_DIRECTIONS[view]),
    flipView: () => place(offset.subVectors(orbit.target, camera.position).normalize()),
    dispose() {
      canvas.removeEventListener('pointerdown', mapButtons)
      canvas.removeEventListener('mousedown', blockAutoscroll)
      canvas.removeEventListener('pointerenter', enter)
      canvas.removeEventListener('pointerleave', leave)
      window.removeEventListener('keydown', onKey)
      orbit.dispose()
    },
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches('input, textarea, [contenteditable]')
}
