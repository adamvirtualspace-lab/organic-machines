import * as THREE from 'three/webgpu'
import type { Command, Selection } from '../../protocol'
import type { NodePlacement } from '../organic/frames'
import { pickShape, type PickTarget } from '../organic/pick'
import type { AxisIndex, MoveGizmo } from './moveGizmo'

/** A press that travels farther than this is a drag, not a click. */
const CLICK_SLOP_PX = 5
const AXIS_NAMES = ['x', 'y', 'z'] as const

export interface ShapeToolsHost {
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  gizmo: MoveGizmo
  size(): { width: number; height: number }
  execute(command: Command): void
  /** Camera navigation is paused while a gizmo arrow is being dragged. */
  setNavigation(enabled: boolean): void
  pickTargets(): PickTarget[]
}

export interface ShapeTools {
  /** What the pointer acts on. `placement` is null when there is nothing to move. */
  setTarget(target: {
    selection: Selection | null
    placement: NodePlacement | null
    value: readonly number[] | null
    enabled: boolean
  }): void
  dispose(): void
}

/**
 * Left click or tap selects the shape under the pointer; dragging a gizmo arrow moves the selected
 * shape along it as one undo step. Must be created before the camera controls, so its listeners
 * run first and can claim a press.
 */
export function attachShapeTools(host: ShapeToolsHost): ShapeTools {
  const { canvas, camera, gizmo } = host
  const ray = new THREE.Ray()
  const ndc = new THREE.Vector3()
  let target: Parameters<ShapeTools['setTarget']>[0] = {
    selection: null,
    placement: null,
    value: null,
    enabled: false,
  }
  let press: { id: number; x: number; y: number } | null = null
  let drag: { id: number; axis: AxisIndex; start: number; from: number; scale: number } | null =
    null

  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const aim = (x: number, y: number) => {
    const { width, height } = host.size()
    ndc.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(camera)
    ray.origin.copy(camera.position)
    ray.direction.copy(ndc).sub(camera.position).normalize()
    return ray
  }

  function onDown(event: PointerEvent): void {
    const plainPress =
      event.isPrimary && event.button === 0 && !event.altKey && !event.ctrlKey && !event.shiftKey
    if (!plainPress || !target.enabled) return
    const { x, y } = local(event)
    const { width, height } = host.size()
    const reach = event.pointerType === 'mouse' ? 10 : 26
    const axis = gizmo.hit(camera, x, y, width, height, reach)
    const start = axis === null ? null : gizmo.along(axis, aim(x, y))
    if (axis !== null && start !== null && target.placement && target.value) {
      drag = {
        id: event.pointerId,
        axis,
        start,
        from: target.value[axis]!,
        scale: target.placement.parent.scale,
      }
      host.setNavigation(false)
      canvas.setPointerCapture(event.pointerId)
      host.execute({ name: 'edit.begin', params: {} })
      return
    }
    press = { id: event.pointerId, x, y }
  }

  function onMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.id) return
    const { x, y } = local(event)
    const now = gizmo.along(drag.axis, aim(x, y))
    const { selection } = target
    if (now === null || !selection?.node) return
    const value = Math.round((drag.from + (now - drag.start) / drag.scale) * 100) / 100
    host.execute({
      name: 'organic.set',
      params: {
        id: selection.object,
        node: selection.node,
        param: `position.${AXIS_NAMES[drag.axis]}`,
        value,
      },
    })
  }

  function onUp(event: PointerEvent): void {
    if (drag && event.pointerId === drag.id) {
      drag = null
      host.setNavigation(true)
      host.execute({
        name: event.type === 'pointercancel' ? 'edit.cancel' : 'edit.commit',
        params: {},
      })
      return
    }
    if (!press || event.pointerId !== press.id) return
    const { x, y } = local(event)
    const clicked = Math.hypot(x - press.x, y - press.y) <= CLICK_SLOP_PX
    press = null
    if (!clicked || event.type === 'pointercancel') return

    const aimed = aim(x, y)
    const hit = pickShape(host.pickTargets(), aimed.origin.toArray(), aimed.direction.toArray())
    if (hit) host.execute({ name: 'select', params: { id: hit.object, node: hit.node } })
    else if (target.selection) host.execute({ name: 'select.clear', params: {} })
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  return {
    setTarget(next) {
      target = next
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    },
  }
}
