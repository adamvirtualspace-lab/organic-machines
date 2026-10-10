import * as THREE from 'three/webgpu'
import type { NodePlacement } from '../organic/frames'

const LENGTH_PX = 84
const COLORS = [0xe0525c, 0x62b85a, 0x4c8fe6]
const UNIT_AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]

export type AxisIndex = 0 | 1 | 2

export interface MoveGizmo {
  readonly object: THREE.Object3D
  /** Shows the gizmo at a node, with its arrows along the axes that node moves on. Null hides it. */
  setPlacement(placement: NodePlacement | null): void
  /** Keeps the arrows a constant size on screen. */
  update(camera: THREE.PerspectiveCamera, height: number): void
  /** The arrow within `reach` pixels of a pointer position, if any. */
  hit(
    camera: THREE.Camera,
    x: number,
    y: number,
    width: number,
    height: number,
    reach: number,
  ): AxisIndex | null
  /**
   * How far along an arrow's line (in world units from the gizmo's centre) the point nearest to a
   * ray lies. Null when the ray runs almost along the arrow, where that point is not well defined.
   */
  along(axis: AxisIndex, ray: THREE.Ray): number | null
}

/** Three arrows for dragging a shape along the axes of the space it sits in. Drawn over everything. */
export function createMoveGizmo(): MoveGizmo {
  const group = new THREE.Group()
  UNIT_AXES.forEach((axis, i) => group.add(arrow(axis, COLORS[i]!)))
  group.visible = false
  group.renderOrder = 2000

  const direction = new THREE.Vector3()
  const start = new THREE.Vector3()
  const tip = new THREE.Vector3()
  const toOrigin = new THREE.Vector3()

  const worldAxis = (axis: AxisIndex) =>
    direction.copy(UNIT_AXES[axis]!).applyQuaternion(group.quaternion)

  return {
    object: group,
    setPlacement(placement) {
      group.visible = placement !== null
      if (!placement) return
      group.position.set(...placement.origin)
      group.quaternion.set(...placement.parent.rotation)
    },
    update(camera, height) {
      if (!group.visible) return
      const distance = camera.position.distanceTo(group.position)
      const worldPerPixel =
        (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height
      group.scale.setScalar(LENGTH_PX * worldPerPixel)
    },
    hit(camera, x, y, width, height, reach) {
      if (!group.visible) return null
      const toPixels = (point: THREE.Vector3) => {
        point.project(camera)
        point.set(((point.x + 1) / 2) * width, ((1 - point.y) / 2) * height, point.z)
      }
      let best: AxisIndex | null = null
      let nearest = reach
      for (const axis of [0, 1, 2] as const) {
        start.copy(group.position)
        tip.copy(group.position).addScaledVector(worldAxis(axis), group.scale.x)
        toPixels(start)
        toPixels(tip)
        if (start.z > 1 || tip.z > 1) continue // Behind the camera.
        // Distance from the pointer to the arrow's segment on screen.
        const dx = tip.x - start.x
        const dy = tip.y - start.y
        const span = dx * dx + dy * dy
        const t = span
          ? THREE.MathUtils.clamp(((x - start.x) * dx + (y - start.y) * dy) / span, 0, 1)
          : 0
        const gap = Math.hypot(x - (start.x + dx * t), y - (start.y + dy * t))
        if (gap < nearest) {
          nearest = gap
          best = axis
        }
      }
      return best
    },
    along(axis, ray) {
      const a = worldAxis(axis)
      const b = a.dot(ray.direction)
      const denominator = 1 - b * b
      if (denominator < 1e-4) return null
      toOrigin.subVectors(group.position, ray.origin)
      return (b * ray.direction.dot(toOrigin) - a.dot(toOrigin)) / denominator
    },
  }
}

/** A unit-length arrow along `direction`, visible through whatever is in front of it. */
function arrow(direction: THREE.Vector3, color: number): THREE.Object3D {
  const material = new THREE.MeshBasicNodeMaterial({ color, depthTest: false, transparent: true })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.8, 8), material)
  shaft.position.y = 0.4
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 14), material)
  head.position.y = 0.9
  shaft.renderOrder = head.renderOrder = 2000

  const group = new THREE.Group()
  group.add(shaft, head)
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
  return group
}
