import {
  abs,
  clamp,
  cross,
  dot,
  float,
  Fn,
  If,
  length,
  max,
  min,
  select,
  sqrt,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { GraphNode, SdfGraph } from './graph'

type F = THREE.Node<'float'>
type V2 = THREE.Node<'vec2'>
type V3 = THREE.Node<'vec3'>
type V4 = THREE.Node<'vec4'>

// The shader half of the SDF library. Each function must match its twin in evaluate.ts.

const sdBox = Fn(([p, half]: [V3, V3]) => {
  const q = abs(p).sub(half)
  return length(max(q, 0)).add(min(max(q.x, max(q.y, q.z)), 0))
})

const sdCylinder = Fn(([p, size]: [V3, V2]) => {
  const d = vec2(length(p.xy).sub(size.x), abs(p.z).sub(size.y))
  return min(max(d.x, d.y), 0).add(length(max(d, 0)))
})

const sdCapsule = Fn(([p, size]: [V3, V2]) => {
  const along = p.z.sub(clamp(p.z, size.y.negate(), size.y))
  return length(vec3(p.xy, along)).sub(size.x)
})

const sdTorus = Fn(([p, size]: [V3, V2]) => {
  return length(vec2(length(p.xy).sub(size.x), p.z)).sub(size.y)
})

/** Exact capped cone with a zero top radius: base at -half, apex at +half. */
const sdCone = Fn(([p, size]: [V3, V2]) => {
  const radius = size.x
  const half = size.y
  const q = vec2(length(p.xy), p.z)
  const ca = vec2(q.x.sub(min(q.x, select(q.y.lessThan(0), radius, float(0)))), abs(q.y).sub(half))
  const t = clamp(
    q.x
      .mul(radius)
      .add(half.sub(q.y).mul(half).mul(2))
      .div(radius.mul(radius).add(half.mul(half).mul(4))),
    0,
    1,
  )
  const cb = vec2(q.x.sub(radius.mul(t)), q.y.sub(half).add(half.mul(t).mul(2)))
  const sign = select(cb.x.lessThan(0).and(ca.y.lessThan(0)), float(-1), float(1))
  return sign.mul(sqrt(min(dot(ca, ca), dot(cb, cb))))
})

/** Polynomial smooth minimum: within `k` of each other, the two distances blend. */
const smoothMin = Fn(([a, b, k]: [F, F, F]) => {
  const h = max(k.sub(abs(a.sub(b))), 0).div(k)
  return min(a, b).sub(h.mul(h).mul(k).mul(0.25))
})

const rotateByQuat = Fn(([v, q]: [V3, V4]) => {
  const t = cross(q.xyz, v).add(v.mul(q.w))
  return v.add(cross(q.xyz, t).mul(2))
})

export type ParamArray = ReturnType<typeof uniformArray<'vec4'>>

/** The graph's parameters as an array of vec4 uniforms, plus the vectors to write new values into. */
export function createParamArray(graph: SdfGraph): { node: ParamArray; vectors: THREE.Vector4[] } {
  const count = Math.max(1, Math.ceil(graph.params.length / 4))
  const vectors = Array.from({ length: count }, () => new THREE.Vector4())
  writeParams(graph, vectors)
  return { node: uniformArray<'vec4'>(vectors, 'vec4'), vectors }
}

export function writeParams(graph: SdfGraph, vectors: THREE.Vector4[]): void {
  const p = graph.params
  vectors.forEach((vector, i) =>
    vector.set(p[i * 4] ?? 0, p[i * 4 + 1] ?? 0, p[i * 4 + 2] ?? 0, p[i * 4 + 3] ?? 0),
  )
}

/** Reads `count` consecutive parameters starting at `offset`; the compiler keeps them in one vec4. */
export function readParam(params: ParamArray, offset: number, count: 1): F
export function readParam(params: ParamArray, offset: number, count: 2): V2
export function readParam(params: ParamArray, offset: number, count: 3): V3
export function readParam(params: ParamArray, offset: number, count: 4): V4
export function readParam(params: ParamArray, offset: number, count: number): THREE.Node {
  const start = offset & 3
  const swizzle = 'xyzw'.slice(start, start + count)
  const element = params.element(offset >> 2) as unknown as Record<string, THREE.Node>
  return element[swizzle]!
}

/**
 * Builds the shader function `distance(point)` for a graph. Each object is skipped when its
 * bounding sphere is farther away than the nearest surface found so far.
 */
export function buildDistanceFn(graph: SdfGraph, params: ParamArray) {
  return Fn(([point]: [V3]) => {
    const nearest = float(1e9).toVar()
    for (const root of graph.roots) {
      const bound = readParam(params, root.bound, 4)
      If(length(point.sub(bound.xyz)).sub(bound.w).lessThan(nearest), () => {
        const values: THREE.Node[] = [point]
        for (let i = root.first; i <= root.node; i++) {
          values[i] = emit(graph.nodes[i]!, values, params).toVar()
        }
        nearest.assign(min(nearest, values[root.node] as F))
      })
    }
    return nearest
  })
}

function emit(node: GraphNode, values: THREE.Node[], params: ParamArray): F | V3 {
  const point = (index: number) => values[index] as V3
  const dist = (index: number) => values[index] as F
  switch (node.op) {
    case 'point':
      return point(0)
    case 'translate':
      return point(node.in).sub(readParam(params, node.p, 3))
    case 'rotate':
      return rotateByQuat(point(node.in), readParam(params, node.p, 4))
    case 'scale':
      return point(node.in).div(readParam(params, node.p, 1))
    case 'mirror': {
      const p = point(node.in)
      return vec3(
        node.axis === 0 ? abs(p.x) : p.x,
        node.axis === 1 ? abs(p.y) : p.y,
        node.axis === 2 ? abs(p.z) : p.z,
      )
    }
    case 'sphere':
      return length(point(node.in)).sub(readParam(params, node.p, 1))
    case 'box':
      return sdBox(point(node.in), readParam(params, node.p, 3))
    case 'roundBox': {
      const size = readParam(params, node.p, 4)
      return sdBox(point(node.in), size.xyz).sub(size.w)
    }
    case 'cylinder':
      return sdCylinder(point(node.in), readParam(params, node.p, 2))
    case 'capsule':
      return sdCapsule(point(node.in), readParam(params, node.p, 2))
    case 'torus':
      return sdTorus(point(node.in), readParam(params, node.p, 2))
    case 'cone':
      return sdCone(point(node.in), readParam(params, node.p, 2))
    case 'plane':
      return point(node.in).z
    case 'volume':
      throw new Error('Sampled volumes are reserved for the bridge and not implemented yet')
    case 'union':
      return min(dist(node.a), dist(node.b))
    case 'subtract':
      return max(dist(node.a), dist(node.b).negate())
    case 'intersect':
      return max(dist(node.a), dist(node.b))
    case 'smoothUnion':
      return smoothMin(dist(node.a), dist(node.b), readParam(params, node.p, 1))
    case 'smoothSubtract':
      return smoothMin(dist(node.a).negate(), dist(node.b), readParam(params, node.p, 1)).negate()
    case 'smoothIntersect':
      return smoothMin(
        dist(node.a).negate(),
        dist(node.b).negate(),
        readParam(params, node.p, 1),
      ).negate()
    case 'shell': {
      const half = readParam(params, node.p, 1)
      return abs(dist(node.in).add(half)).sub(half)
    }
    case 'round':
      return dist(node.in).sub(readParam(params, node.p, 1))
    case 'scaleDistance':
      return dist(node.in).mul(readParam(params, node.p, 1))
  }
}
