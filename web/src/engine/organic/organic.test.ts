import { describe, expect, it } from 'vitest'
import conformance from './conformance.json'
import { demoScene, STRESS_OBJECTS, STRESS_PRIMITIVES_PER_OBJECT } from './demos'
import { createEvaluator } from './evaluate'
import { compileScene, structureKey, type GraphNode } from './graph'
import { childrenOf, parseTree, setTreeParam, type SdfTree } from './tree'

const trees = (name: 'test' | 'stress') => demoScene(name).map((object) => object.sdf)

describe('CPU evaluator against the conformance vectors', () => {
  for (const testCase of conformance.cases) {
    it(testCase.name, () => {
      const distance = createEvaluator(compileScene(testCase.trees as unknown as SdfTree[]))
      for (const [x, y, z, expected] of testCase.points as number[][]) {
        expect(distance(x!, y!, z!), `at (${x}, ${y}, ${z})`).toBeCloseTo(expected!, 9)
      }
    })
  }

  it('covers every node type the compiler can emit', () => {
    const emitted = new Set<GraphNode['op']>()
    for (const testCase of conformance.cases) {
      for (const node of compileScene(testCase.trees as unknown as SdfTree[]).nodes)
        emitted.add(node.op)
    }
    expect([...emitted].sort()).toEqual(
      [
        'point',
        'translate',
        'rotate',
        'scale',
        'mirror',
        'sphere',
        'box',
        'roundBox',
        'cylinder',
        'capsule',
        'torus',
        'cone',
        'plane',
        'union',
        'subtract',
        'intersect',
        'smoothUnion',
        'smoothSubtract',
        'smoothIntersect',
        'shell',
        'round',
        'scaleDistance',
      ].sort(),
    )
  })
})

describe('compileScene', () => {
  it('keeps the structure key when only a value changes', () => {
    const [block, ring] = trees('test')
    const before = compileScene([block!, ring!])
    const after = compileScene([setTreeParam(block!, 'n3', 'radius', 12), ring!])
    expect(structureKey(after)).toBe(structureKey(before))
    expect(after.params).not.toEqual(before.params)
  })

  it('changes the structure key when a rotation is added', () => {
    const [block, ring] = trees('test')
    const turned = setTreeParam(ring!, 'n1', 'rotation.x', 30)
    expect(structureKey(compileScene([block!, turned]))).not.toBe(
      structureKey(compileScene([block!, ring!])),
    )
  })

  it('keeps multi-value parameters inside one group of four', () => {
    const graph = compileScene(trees('stress'))
    const widths: Partial<Record<GraphNode['op'], number>> = {
      translate: 3,
      rotate: 4,
      box: 3,
      roundBox: 4,
      cylinder: 2,
      capsule: 2,
      torus: 2,
      cone: 2,
    }
    for (const node of graph.nodes) {
      const width = widths[node.op]
      if (width && 'p' in node) expect((node.p % 4) + width).toBeLessThanOrEqual(4)
    }
    for (const root of graph.roots) expect(root.bound % 4).toBe(0)
  })

  it('builds the stress scene as 10 objects of 10 primitives', () => {
    const scene = trees('stress')
    const leaves = (tree: SdfTree): number =>
      childrenOf(tree).length === 0 ? 1 : childrenOf(tree).reduce((sum, c) => sum + leaves(c), 0)
    expect(scene).toHaveLength(STRESS_OBJECTS)
    for (const tree of scene) expect(leaves(tree)).toBe(STRESS_PRIMITIVES_PER_OBJECT)
    expect(compileScene(scene).roots).toHaveLength(STRESS_OBJECTS)
  })

  // The shader skips an object whenever its bounding sphere is farther than the nearest surface
  // found so far. That is only safe if an object's distance is never less than the distance to
  // its own bounding sphere, so check that everywhere, smooth blends included.
  it('gives every object a bound its distance never undercuts', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (const tree of [...trees('stress'), ...trees('test')]) {
      const graph = compileScene([tree])
      const distance = createEvaluator(graph)
      const [cx, cy, cz, radius] = graph.params.slice(graph.roots[0]!.bound) as number[]
      for (let i = 0; i < 4000; i++) {
        const [x, y, z] = [
          cx! + (random() - 0.5) * 500,
          cy! + (random() - 0.5) * 500,
          cz! + (random() - 0.5) * 500,
        ]
        const toBound = Math.hypot(x - cx!, y - cy!, z - cz!) - radius!
        expect(distance(x, y, z)).toBeGreaterThanOrEqual(toBound - 1e-6)
      }
    }
  })

  it('caps the bound of an unbounded shape', () => {
    const graph = compileScene([{ id: 'a', kind: 'plane', position: [0, 0, 0] }])
    expect(graph.params.slice(graph.sceneBound, graph.sceneBound + 4)).toEqual([0, 0, 0, 100_000])
  })
})

describe('setTreeParam', () => {
  const [block] = trees('test')

  it('changes one value and shares untouched branches', () => {
    const next = setTreeParam(block!, 'n3', 'position.z', 40)
    const [box, sphere] = childrenOf(next)
    expect(sphere).toMatchObject({ id: 'n3', position: [25, -25, 40] })
    expect(box).toBe(childrenOf(block!)[0])
    expect(childrenOf(block!)[1]).toMatchObject({ position: [25, -25, 25] })
  })

  it.each([
    ['nope', 'radius', 1, 'There is no node "nope"'],
    ['n3', 'size.x', 1, 'A sphere has no parameter "size.x"'],
    ['n3', 'position', 1, '"position" needs an axis: position.x, .y or .z'],
    ['n3', 'radius.x', 1, 'A sphere has no parameter "radius.x"'],
    ['n3', 'kind', 1, 'A sphere has no parameter "kind"'],
    ['n3', 'scale', 0, 'Scale must be above zero'],
    ['n3', 'radius', NaN, 'The value must be a number'],
  ])('rejects %s %s = %s', (node, param, value, message) => {
    expect(() => setTreeParam(block!, node, param, value)).toThrow(message)
  })
})

describe('parseTree', () => {
  it('accepts every demo shape unchanged', () => {
    for (const tree of [...trees('test'), ...trees('stress')]) {
      expect(parseTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree)
    }
  })

  it.each([
    ['an unknown kind', { id: 'a', kind: 'blob', position: [0, 0, 0] }, 'unknown kind'],
    ['a missing number', { id: 'a', kind: 'sphere', position: [0, 0, 0] }, 'invalid parameter'],
    [
      'a short vector',
      { id: 'a', kind: 'sphere', position: [0, 0], radius: 1 },
      'invalid parameter',
    ],
    [
      'a zero scale',
      { id: 'a', kind: 'sphere', position: [0, 0, 0], radius: 1, scale: 0 },
      'invalid parameter',
    ],
    [
      'an empty boolean',
      { id: 'a', kind: 'union', position: [0, 0, 0], blend: 0, children: [] },
      'at least one child',
    ],
    [
      'a repeated id',
      {
        id: 'a',
        kind: 'round',
        position: [0, 0, 0],
        radius: 1,
        child: { id: 'a', kind: 'plane', position: [0, 0, 0] },
      },
      'missing or repeated id',
    ],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseTree(raw)).toThrow(message)
  })

  it('drops fields it does not know', () => {
    const parsed = parseTree({
      id: 'a',
      kind: 'sphere',
      position: [0, 0, 0],
      radius: 1,
      evil: true,
    })
    expect(parsed).toEqual({ id: 'a', kind: 'sphere', position: [0, 0, 0], radius: 1 })
  })
})
