import { describe, expect, it } from 'vitest'
import type { SdfTree } from '../../protocol'
import { demoScene } from './demos'
import { createEvaluator } from './evaluate'
import { placeNode } from './frames'
import { compileScene } from './graph'
import { rotate } from './math'
import { pickShape, type PickTarget } from './pick'

const targets: PickTarget[] = demoScene('test').map((object, index) => {
  const graph = compileScene([object.sdf])
  return { id: `o${index + 1}`, graph, evaluate: createEvaluator(graph) }
})
const down = [0, 0, -1] as const

describe('pickShape', () => {
  it('hits the top of the block and names the box', () => {
    const hit = pickShape(targets, [-30, 30, 300], down)
    expect(hit).toMatchObject({ object: 'o1', node: 'n2' })
    expect(hit!.distance).toBeCloseTo(240, 1) // The block's top face is at z = 60.
  })

  it('names the carving sphere when the ray lands in the hollow', () => {
    const hit = pickShape(targets, [25, -25, 300], down)
    expect(hit).toMatchObject({ object: 'o1', node: 'n3' })
    expect(hit!.distance).toBeGreaterThan(245)
  })

  it('hits the second object where only it is under the ray', () => {
    const hit = pickShape(targets, [165, 40, 300], down)
    expect(hit).toMatchObject({ object: 'o2', node: 'n1' })
    expect(hit!.distance).toBeCloseTo(276, 1) // The torus tube tops out at z = 24.
  })

  it('reports the nearer object when the ray passes through both', () => {
    // Along +X at a height both shapes cover: the block's face at x = -40 comes first.
    expect(pickShape(targets, [-300, 30, 12], [1, 0, 0])).toMatchObject({ object: 'o1' })
    expect(pickShape(targets, [400, 40, 12], [-1, 0, 0])).toMatchObject({ object: 'o2' })
  })

  it('returns null when the ray meets nothing', () => {
    expect(pickShape(targets, [0, 300, 300], down)).toBeNull()
    expect(pickShape(targets, [0, 0, 300], [0, 0, 1])).toBeNull()
    expect(pickShape([], [0, 0, 300], down)).toBeNull()
  })
})

describe('placeNode', () => {
  const tree: SdfTree = {
    id: 'g',
    kind: 'union',
    position: [100, 0, 0],
    rotation: [0, 0, 90],
    scale: 2,
    blend: 0,
    children: [{ id: 'a', kind: 'sphere', position: [10, 0, 0], radius: 5 }],
  }

  it('places the root in world space', () => {
    expect(placeNode(tree, 'g')).toEqual({
      parent: { origin: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
      origin: [100, 0, 0],
    })
  })

  it('carries the move, turn and scale of a parent down to its child', () => {
    const placed = placeNode(tree, 'a')!
    // Local +X is world +Y after the quarter turn, and the scale doubles the offset.
    expect(placed.origin[0]).toBeCloseTo(100)
    expect(placed.origin[1]).toBeCloseTo(20)
    expect(placed.origin[2]).toBeCloseTo(0)
    expect(placed.parent.scale).toBe(2)
    const [x, y, z] = rotate([1, 0, 0], placed.parent.rotation)
    expect([x, y, z].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([0, 1, 0])
  })

  it('returns undefined for a node that is not in the tree', () => {
    expect(placeNode(tree, 'missing')).toBeUndefined()
  })
})
