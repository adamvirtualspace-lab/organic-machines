import type { SdfGraph } from './graph'

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** Polynomial smooth minimum: within `k` of each other, the two distances blend. */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export interface Evaluator {
  (x: number, y: number, z: number): number
  /** The distance one graph node produced at the point last evaluated. */
  nodeValue(index: number): number
}

/**
 * The CPU evaluator: returns a function giving the signed distance at a point.
 * It must agree with the shader built from the same graph (see conformance.json).
 */
export function createEvaluator(graph: SdfGraph): Evaluator {
  const { nodes, roots } = graph
  const P = Float64Array.from(graph.params)
  // Three slots per node: a point uses all of them, a distance only the first.
  const v = new Float64Array(nodes.length * 3)

  const evaluate = (x: number, y: number, z: number): number => {
    v[0] = x
    v[1] = y
    v[2] = z
    for (let i = 1; i < nodes.length; i++) {
      const node = nodes[i]!
      const o = i * 3
      switch (node.op) {
        case 'point':
          break
        case 'translate': {
          const s = node.in * 3
          v[o] = v[s]! - P[node.p]!
          v[o + 1] = v[s + 1]! - P[node.p + 1]!
          v[o + 2] = v[s + 2]! - P[node.p + 2]!
          break
        }
        case 'rotate': {
          const s = node.in * 3
          const [px, py, pz] = [v[s]!, v[s + 1]!, v[s + 2]!]
          const [qx, qy, qz, qw] = [P[node.p]!, P[node.p + 1]!, P[node.p + 2]!, P[node.p + 3]!]
          const tx = qy * pz - qz * py + qw * px
          const ty = qz * px - qx * pz + qw * py
          const tz = qx * py - qy * px + qw * pz
          v[o] = px + 2 * (qy * tz - qz * ty)
          v[o + 1] = py + 2 * (qz * tx - qx * tz)
          v[o + 2] = pz + 2 * (qx * ty - qy * tx)
          break
        }
        case 'scale': {
          const s = node.in * 3
          const k = P[node.p]!
          v[o] = v[s]! / k
          v[o + 1] = v[s + 1]! / k
          v[o + 2] = v[s + 2]! / k
          break
        }
        case 'mirror': {
          const s = node.in * 3
          v[o] = v[s]!
          v[o + 1] = v[s + 1]!
          v[o + 2] = v[s + 2]!
          v[o + node.axis] = Math.abs(v[s + node.axis]!)
          break
        }
        case 'sphere': {
          const s = node.in * 3
          v[o] = Math.hypot(v[s]!, v[s + 1]!, v[s + 2]!) - P[node.p]!
          break
        }
        case 'box':
        case 'roundBox': {
          const s = node.in * 3
          const qx = Math.abs(v[s]!) - P[node.p]!
          const qy = Math.abs(v[s + 1]!) - P[node.p + 1]!
          const qz = Math.abs(v[s + 2]!) - P[node.p + 2]!
          const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
          const rounding = node.op === 'roundBox' ? P[node.p + 3]! : 0
          v[o] = outside + Math.min(Math.max(qx, qy, qz), 0) - rounding
          break
        }
        case 'cylinder': {
          const s = node.in * 3
          const dx = Math.hypot(v[s]!, v[s + 1]!) - P[node.p]!
          const dy = Math.abs(v[s + 2]!) - P[node.p + 1]!
          v[o] = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
          break
        }
        case 'capsule': {
          const s = node.in * 3
          const half = P[node.p + 1]!
          const pz = v[s + 2]!
          v[o] = Math.hypot(v[s]!, v[s + 1]!, pz - clamp(pz, -half, half)) - P[node.p]!
          break
        }
        case 'torus': {
          const s = node.in * 3
          const ring = Math.hypot(v[s]!, v[s + 1]!) - P[node.p]!
          v[o] = Math.hypot(ring, v[s + 2]!) - P[node.p + 1]!
          break
        }
        case 'cone': {
          // Exact capped cone with a zero top radius: base at -half, apex at +half.
          const s = node.in * 3
          const radius = P[node.p]!
          const half = P[node.p + 1]!
          const qx = Math.hypot(v[s]!, v[s + 1]!)
          const qy = v[s + 2]!
          const cax = qx - Math.min(qx, qy < 0 ? radius : 0)
          const cay = Math.abs(qy) - half
          const t = clamp(
            (qx * radius + (half - qy) * 2 * half) / (radius * radius + 4 * half * half),
            0,
            1,
          )
          const cbx = qx - radius * t
          const cby = qy - half + 2 * half * t
          const sign = cbx < 0 && cay < 0 ? -1 : 1
          v[o] = sign * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
          break
        }
        case 'plane':
          v[o] = v[node.in * 3 + 2]!
          break
        case 'volume':
          throw new Error('Sampled volumes are reserved for the bridge and not implemented yet')
        case 'union':
          v[o] = Math.min(v[node.a * 3]!, v[node.b * 3]!)
          break
        case 'subtract':
          v[o] = Math.max(v[node.a * 3]!, -v[node.b * 3]!)
          break
        case 'intersect':
          v[o] = Math.max(v[node.a * 3]!, v[node.b * 3]!)
          break
        case 'smoothUnion':
          v[o] = smoothMin(v[node.a * 3]!, v[node.b * 3]!, P[node.p]!)
          break
        case 'smoothSubtract':
          v[o] = -smoothMin(-v[node.a * 3]!, v[node.b * 3]!, P[node.p]!)
          break
        case 'smoothIntersect':
          v[o] = -smoothMin(-v[node.a * 3]!, -v[node.b * 3]!, P[node.p]!)
          break
        case 'shell': {
          const half = P[node.p]!
          v[o] = Math.abs(v[node.in * 3]! + half) - half
          break
        }
        case 'round':
          v[o] = v[node.in * 3]! - P[node.p]!
          break
        case 'scaleDistance':
          v[o] = v[node.in * 3]! * P[node.p]!
          break
      }
    }
    let distance = Infinity
    for (const root of roots) distance = Math.min(distance, v[root.node * 3]!)
    return distance
  }
  return Object.assign(evaluate, { nodeValue: (index: number) => v[index * 3]! })
}
