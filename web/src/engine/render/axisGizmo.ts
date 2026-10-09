import * as THREE from 'three/webgpu'

const SIZE_PX = 34
const MARGIN_PX = 52

export interface AxisGizmo {
  readonly object: THREE.Object3D
  /** Pins the gizmo to the bottom-left corner at a constant pixel size. */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void
}

/**
 * World-axis indicator (X red, Y green, Z blue). It lives in the main scene just beyond the
 * near plane and keeps world orientation, so it shows how the view is turned.
 */
export function createAxisGizmo(): AxisGizmo {
  const group = new THREE.Group()
  group.add(
    arrow(new THREE.Vector3(1, 0, 0), 0xe0525c),
    arrow(new THREE.Vector3(0, 1, 0), 0x62b85a),
    arrow(new THREE.Vector3(0, 0, 1), 0x4c8fe6),
  )
  const corner = new THREE.Vector3()

  return {
    object: group,
    update(camera, width, height) {
      const depth = camera.near * 20
      corner
        .set(-1 + (2 * MARGIN_PX) / width, -1 + (2 * MARGIN_PX) / height, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize()
      group.position.copy(camera.position).addScaledVector(corner, depth)
      const worldPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height
      group.scale.setScalar(SIZE_PX * worldPerPixel)
    },
  }
}

/** A unit-length arrow along `direction`. */
function arrow(direction: THREE.Vector3, color: number): THREE.Object3D {
  const material = new THREE.MeshBasicNodeMaterial({ color })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8), material)
  shaft.position.y = 0.375
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.25, 12), material)
  head.position.y = 0.875

  const group = new THREE.Group()
  group.add(shaft, head)
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
  return group
}
