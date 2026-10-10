import type { Evaluator } from './evaluate'
import type { SdfGraph } from './graph'
import type { Vec3 } from './math'

const MAX_STEPS = 160
const STEP_FACTOR = 0.9
const HIT_FRACTION = 0.0007
const MIN_HIT_DISTANCE = 0.002

export interface PickTarget {
  id: string
  graph: SdfGraph
  evaluate: Evaluator
}

export interface PickHit {
  object: string
  /** The primitive whose surface is nearest the hit point. */
  node: string | undefined
  distance: number
}

/**
 * Traces one ray through the objects on the CPU and reports the first surface it meets.
 * It walks the same way the shader does, so what gets picked is what is drawn.
 */
export function pickShape(
  targets: readonly PickTarget[],
  origin: Vec3,
  direction: Vec3,
): PickHit | null {
  let best: PickHit | null = null
  for (const { id, graph, evaluate } of targets) {
    const [cx, cy, cz, radius] = graph.params.slice(graph.sceneBound, graph.sceneBound + 4)
    const ox = origin[0] - cx!
    const oy = origin[1] - cy!
    const oz = origin[2] - cz!
    const b = ox * direction[0] + oy * direction[1] + oz * direction[2]
    const discriminant = b * b - (ox * ox + oy * oy + oz * oz - radius! * radius!)
    if (discriminant < 0) continue
    const reach = Math.sqrt(discriminant)
    let t = Math.max(-b - reach, 0)
    const end = Math.min(-b + reach, best?.distance ?? Infinity)

    for (let step = 0; step < MAX_STEPS && t <= end; step++) {
      const d = evaluate(
        origin[0] + direction[0] * t,
        origin[1] + direction[1] * t,
        origin[2] + direction[2] * t,
      )
      if (d < t * HIT_FRACTION + MIN_HIT_DISTANCE) {
        // The evaluator still holds every node's value at this point.
        let node: string | undefined
        let nearest = Infinity
        for (const leaf of graph.leaves) {
          const gap = Math.abs(evaluate.nodeValue(leaf.node))
          if (gap < nearest) {
            nearest = gap
            node = leaf.id
          }
        }
        best = { object: id, node, distance: t }
        break
      }
      t += d * STEP_FACTOR
    }
  }
  return best
}
