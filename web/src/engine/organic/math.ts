export type Vec3 = readonly [number, number, number]
export type Quat = readonly [x: number, y: number, z: number, w: number]

export interface Sphere {
  center: Vec3
  radius: number
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])

/** Euler angles in degrees, applied about X, then Y, then Z (fixed axes). */
export function quatFromEuler([x, y, z]: Vec3): Quat {
  const h = Math.PI / 360
  const [sx, cx] = [Math.sin(x * h), Math.cos(x * h)]
  const [sy, cy] = [Math.sin(y * h), Math.cos(y * h)]
  const [sz, cz] = [Math.sin(z * h), Math.cos(z * h)]
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]
}

export const conjugate = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w]

export function rotate(v: Vec3, [qx, qy, qz, qw]: Quat): Vec3 {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + w * v)
  const tx = qy * v[2] - qz * v[1] + qw * v[0]
  const ty = qz * v[0] - qx * v[2] + qw * v[1]
  const tz = qx * v[1] - qy * v[0] + qw * v[2]
  return [
    v[0] + 2 * (qy * tz - qz * ty),
    v[1] + 2 * (qz * tx - qx * tz),
    v[2] + 2 * (qx * ty - qy * tx),
  ]
}

/** The smallest sphere that holds both. */
export function enclose(a: Sphere, b: Sphere): Sphere {
  if (!Number.isFinite(a.radius)) return a
  if (!Number.isFinite(b.radius)) return b
  const offset = sub(b.center, a.center)
  const distance = length(offset)
  if (distance + b.radius <= a.radius) return a
  if (distance + a.radius <= b.radius) return b
  const radius = (distance + a.radius + b.radius) / 2
  return { center: add(a.center, mul(offset, (radius - a.radius) / distance)), radius }
}
