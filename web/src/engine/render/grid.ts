import {
  abs,
  cameraPosition,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'

const AXIS_LENGTH = 100_000 // mm

export interface Grid {
  readonly object: THREE.Object3D
  /** Re-centres the grid under the view and picks a cell size that suits the zoom level. */
  update(target: THREE.Vector3, distance: number): void
}

/** An "infinite" ground grid on the XY plane (Z is up), with the X and Y axes drawn through the origin. */
export function createGrid(): Grid {
  const cell = uniform(10)
  const reach = uniform(1000)

  // Anti-aliased lines: distance to the nearest line, measured in pixels via screen derivatives.
  const lines = (size: THREE.Node<'float'>) => {
    const coord = positionWorld.xy.div(size)
    const perPixel = fwidth(coord) // cells crossed per screen pixel
    const pixels = abs(fract(coord.sub(0.5)).sub(0.5)).div(perPixel)
    const line = float(1).sub(min(min(pixels.x, pixels.y), 1))
    // Lines closer together than a few pixels would merge into a grey haze, so fade them out.
    return line.mul(float(1).sub(smoothstep(0.08, 0.3, max(perPixel.x, perPixel.y))))
  }
  const fade = float(1).sub(
    smoothstep(reach.mul(0.35), reach, length(positionWorld.sub(cameraPosition))),
  )

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  material.colorNode = vec3(0.62, 0.65, 0.7)
  material.opacityNode = max(lines(cell).mul(0.12), lines(cell.mul(10)).mul(0.32)).mul(fade)

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  plane.frustumCulled = false

  const group = new THREE.Group()
  group.add(plane, axisLine(new THREE.Vector3(1, 0, 0), 0xd0525c))
  group.add(axisLine(new THREE.Vector3(0, 1, 0), 0x5fae57))

  return {
    object: group,
    update(target, distance) {
      // Minor cells step by powers of ten so they stay a readable size on screen.
      cell.value = 10 ** Math.floor(Math.log10(Math.max(distance, 1e-3) / 20))
      reach.value = distance * 8
      plane.position.set(target.x, target.y, 0)
      plane.scale.setScalar(reach.value)
    },
  }
}

function axisLine(direction: THREE.Vector3, color: number): THREE.Line {
  const end = direction.clone().multiplyScalar(AXIS_LENGTH)
  const geometry = new THREE.BufferGeometry().setFromPoints([end.clone().negate(), end])
  const line = new THREE.Line(geometry, new THREE.LineBasicNodeMaterial({ color }))
  line.frustumCulled = false
  return line
}
