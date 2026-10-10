import { describe, expect, it } from 'vitest'
import { childrenOf, findNode, type Command, type SdfTree } from '../protocol'
import { createEngine } from './engine'
import { compileScene } from './organic/graph'
import { visibleTree } from './organic/tree'

/** An engine plus helpers that read back the first object's shape. */
function setup() {
  const engine = createEngine()
  const run = (command: Command) => engine.execute(command)
  const objects = () => engine.query('state').objects
  const shape = (index = 0) => objects()[index]!.sdf!
  const kinds = (tree: SdfTree): unknown =>
    childrenOf(tree).length ? [tree.kind, ...childrenOf(tree).map(kinds)] : tree.kind
  return { engine, run, objects, shape, kinds, state: () => engine.query('state') }
}

describe('adding shapes', () => {
  it('starts a new object resting on the ground, and selects it', async () => {
    const { run, objects, state } = setup()
    expect(await run({ name: 'organic.add', params: { kind: 'box' } })).toEqual({ ok: true })
    expect(objects()).toEqual([
      {
        id: 'o1',
        name: 'Box',
        mode: 'organic',
        sdf: { id: 'n1', kind: 'box', position: [0, 0, 20], size: [40, 40, 40] },
      },
    ])
    expect(state().selection).toEqual({ object: 'o1', node: 'n1' })
  })

  it('wraps the target in a smooth boolean, lifting the new shape clear of it', async () => {
    const { run, shape, state } = setup()
    await run({ name: 'organic.add', params: { kind: 'box' } })
    await run({ name: 'organic.add', params: { kind: 'sphere', id: 'o1' } })
    expect(shape()).toEqual({
      id: 'n3',
      kind: 'union',
      position: [0, 0, 0],
      blend: 6,
      children: [
        { id: 'n1', kind: 'box', position: [0, 0, 20], size: [40, 40, 40] },
        { id: 'n2', kind: 'sphere', position: [0, 0, 50], radius: 20 },
      ],
    })
    expect(state().selection).toEqual({ object: 'o1', node: 'n2' })
  })

  it('joins an existing boolean of the same kind instead of nesting another', async () => {
    const { run, shape, kinds } = setup()
    await run({ name: 'organic.add', params: { kind: 'box' } })
    await run({ name: 'organic.add', params: { kind: 'sphere', id: 'o1' } })
    // Target the root union itself, then a shape inside it: both join that union.
    await run({ name: 'organic.add', params: { kind: 'cone', id: 'o1' } })
    await run({ name: 'organic.add', params: { kind: 'torus', id: 'o1', node: 'n1' } })
    expect(kinds(shape())).toEqual(['union', 'box', 'sphere', 'cone', 'torus'])
  })

  it('nests when the operation differs, building left to right', async () => {
    const { run, shape, kinds } = setup()
    await run({ name: 'organic.add', params: { kind: 'box' } })
    await run({ name: 'organic.add', params: { kind: 'sphere', id: 'o1' } })
    await run({ name: 'organic.add', params: { kind: 'cylinder', op: 'subtract', id: 'o1' } })
    await run({ name: 'organic.add', params: { kind: 'capsule', id: 'o1' } })
    expect(kinds(shape())).toEqual([
      'union',
      ['subtract', ['union', 'box', 'sphere'], 'cylinder'],
      'capsule',
    ])
  })

  it('gives every node a distinct id however the tree was built', async () => {
    const { run, shape } = setup()
    await run({ name: 'organic.add', params: { kind: 'box' } })
    for (const op of ['union', 'subtract', 'union', 'intersect', 'subtract'] as const) {
      await run({ name: 'organic.add', params: { kind: 'sphere', op, id: 'o1' } })
    }
    const ids: string[] = []
    const visit = (tree: SdfTree) => (ids.push(tree.id), childrenOf(tree).forEach(visit))
    visit(shape())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('refuses in Machines mode, for a missing node, and for a missing object', async () => {
    const { run } = setup()
    await run({ name: 'organic.add', params: { kind: 'box' } })
    expect(
      await run({ name: 'organic.add', params: { kind: 'box', id: 'o1', node: 'n9' } }),
    ).toEqual({
      ok: false,
      error: 'There is no node "n9"',
    })
    expect(await run({ name: 'organic.add', params: { kind: 'box', id: 'o7' } })).toEqual({
      ok: false,
      error: 'There is no object "o7"',
    })
    await run({ name: 'mode.set', params: { mode: 'machines' } })
    expect(await run({ name: 'organic.add', params: { kind: 'box' } })).toEqual({
      ok: false,
      error: 'Switch to Organic mode to add shapes',
    })
  })
})

describe('changing the tree', () => {
  async function blockWithHole() {
    const context = setup()
    const { run } = context
    await run({ name: 'organic.add', params: { kind: 'box' } })
    await run({ name: 'organic.add', params: { kind: 'sphere', id: 'o1' } })
    await run({ name: 'organic.add', params: { kind: 'cylinder', op: 'subtract', id: 'o1' } })
    return context // subtract n5 [ union n3 [ box n1, sphere n2 ], cylinder n4 ]
  }

  it('removes a node, then prunes booleans left empty, then the object itself', async () => {
    const { run, shape, kinds, objects } = await blockWithHole()
    await run({ name: 'organic.remove', params: { id: 'o1', node: 'n2' } })
    expect(kinds(shape())).toEqual(['subtract', ['union', 'box'], 'cylinder'])
    await run({ name: 'organic.remove', params: { id: 'o1', node: 'n1' } })
    expect(kinds(shape())).toEqual(['subtract', 'cylinder'])
    await run({ name: 'organic.remove', params: { id: 'o1', node: 'n4' } })
    expect(objects()).toEqual([])
  })

  it('moves the selection to the root when the selected node is removed', async () => {
    const { run, state } = await blockWithHole()
    expect(state().selection).toEqual({ object: 'o1', node: 'n4' })
    await run({ name: 'organic.remove', params: { id: 'o1', node: 'n4' } })
    expect(state().selection).toEqual({ object: 'o1', node: 'n5' })
  })

  it('reorders siblings and says when a node is already at the end', async () => {
    const { run, shape, kinds } = await blockWithHole()
    await run({ name: 'organic.move', params: { id: 'o1', node: 'n2', by: -1 } })
    expect(kinds(shape())).toEqual(['subtract', ['union', 'sphere', 'box'], 'cylinder'])
    expect(await run({ name: 'organic.move', params: { id: 'o1', node: 'n2', by: -1 } })).toEqual({
      ok: false,
      error: 'It is already first',
    })
    expect(await run({ name: 'organic.move', params: { id: 'o1', node: 'n5', by: 1 } })).toEqual({
      ok: false,
      error: 'This node has no siblings',
    })
  })

  it('wraps a node in a modifier and selects the modifier', async () => {
    const { run, shape, kinds, state } = await blockWithHole()
    await run({ name: 'organic.wrap', params: { id: 'o1', node: 'n1', kind: 'mirror' } })
    expect(kinds(shape())).toEqual(['subtract', ['union', ['mirror', 'box'], 'sphere'], 'cylinder'])
    expect(state().selection).toEqual({ object: 'o1', node: 'n6' })
    await run({ name: 'organic.axis', params: { id: 'o1', node: 'n6', axis: 'y' } })
    expect(findNode(shape(), 'n6')).toMatchObject({ kind: 'mirror', axis: 'y' })
    expect(
      await run({ name: 'organic.axis', params: { id: 'o1', node: 'n1', axis: 'y' } }),
    ).toEqual({
      ok: false,
      error: 'A box has no mirror axis',
    })
  })

  it('switches a boolean between operations, and only a boolean', async () => {
    const { run, shape, kinds } = await blockWithHole()
    await run({ name: 'organic.op', params: { id: 'o1', node: 'n5', op: 'intersect' } })
    expect(kinds(shape())).toEqual(['intersect', ['union', 'box', 'sphere'], 'cylinder'])
    expect(
      await run({ name: 'organic.op', params: { id: 'o1', node: 'n1', op: 'union' } }),
    ).toEqual({
      ok: false,
      error: 'A box does not combine shapes',
    })
  })

  it('names a node, and clears the name when given an empty one', async () => {
    const { run, shape } = await blockWithHole()
    await run({ name: 'organic.rename', params: { id: 'o1', node: 'n2', name: '  Head ' } })
    expect(findNode(shape(), 'n2')).toMatchObject({ name: 'Head' })
    await run({ name: 'organic.rename', params: { id: 'o1', node: 'n2', name: '' } })
    expect(findNode(shape(), 'n2')).not.toHaveProperty('name')
  })

  it('leaves hidden nodes out of what is drawn', async () => {
    const { run, shape, kinds } = await blockWithHole()
    await run({ name: 'organic.hide', params: { id: 'o1', node: 'n4', hidden: true } })
    expect(findNode(shape(), 'n4')).toMatchObject({ hidden: true })
    expect(kinds(visibleTree(shape())!)).toEqual(['subtract', ['union', 'box', 'sphere']])

    // Hiding the shape a subtract cuts from hides the whole subtract.
    await run({ name: 'organic.hide', params: { id: 'o1', node: 'n3', hidden: true } })
    expect(visibleTree(shape())).toBeUndefined()

    await run({ name: 'organic.hide', params: { id: 'o1', node: 'n3', hidden: false } })
    await run({ name: 'organic.hide', params: { id: 'o1', node: 'n4', hidden: false } })
    expect(findNode(shape(), 'n4')).not.toHaveProperty('hidden')
    expect(visibleTree(shape())).toBe(shape())
  })

  it('still compiles after every kind of edit', async () => {
    const { run, shape } = await blockWithHole()
    await run({ name: 'organic.wrap', params: { id: 'o1', node: 'n5', kind: 'shell' } })
    await run({ name: 'organic.wrap', params: { id: 'o1', node: 'n2', kind: 'round' } })
    await run({
      name: 'organic.set',
      params: { id: 'o1', node: 'n2', param: 'rotation.y', value: 30 },
    })
    await run({ name: 'organic.set', params: { id: 'o1', node: 'n1', param: 'scale', value: 1.5 } })
    expect(compileScene([visibleTree(shape())!]).roots).toHaveLength(1)
  })
})

describe('selection', () => {
  it('selects an object by its root, or one node, and can be cleared', async () => {
    const { run, state } = setup()
    await run({ name: 'demo.scene', params: { name: 'test' } })
    expect(state().selection).toBeNull()
    await run({ name: 'select', params: { id: 'o1' } })
    expect(state().selection).toEqual({ object: 'o1', node: 'n1' })
    await run({ name: 'select', params: { id: 'o1', node: 'n3' } })
    expect(state().selection).toEqual({ object: 'o1', node: 'n3' })
    expect(await run({ name: 'select', params: { id: 'o1', node: 'n9' } })).toEqual({
      ok: false,
      error: 'There is no node "n9"',
    })
    expect(state().selection).toEqual({ object: 'o1', node: 'n3' })
    await run({ name: 'select.clear', params: {} })
    expect(state().selection).toBeNull()
  })

  it('is dropped when the mode changes or the object goes away', async () => {
    const { run, state } = setup()
    await run({ name: 'organic.add', params: { kind: 'sphere' } })
    await run({ name: 'mode.set', params: { mode: 'machines' } })
    expect(state().selection).toBeNull()
    expect(await run({ name: 'select', params: { id: 'o1' } })).toMatchObject({ ok: false })

    await run({ name: 'mode.set', params: { mode: 'organic' } })
    await run({ name: 'select', params: { id: 'o1' } })
    await run({ name: 'undo', params: {} })
    expect(state().selection).toBeNull()
  })

  it('is not an undo step', async () => {
    const { run, state } = setup()
    await run({ name: 'demo.scene', params: { name: 'test' } })
    await run({ name: 'select', params: { id: 'o2' } })
    await run({ name: 'undo', params: {} })
    expect(state().objects).toEqual([])
  })
})

describe('live edits', () => {
  const drag = (value: number): Command => ({
    name: 'organic.set',
    params: { id: 'o1', node: 'n1', param: 'radius', value },
  })

  it('previews every change but records a single undo step on commit', async () => {
    const { run, shape, state } = setup()
    await run({ name: 'organic.add', params: { kind: 'sphere' } })
    await run({ name: 'edit.begin', params: {} })
    for (const value of [21, 25, 30, 34]) {
      await run(drag(value))
      expect(shape()).toMatchObject({ radius: value })
    }
    await run({ name: 'edit.commit', params: {} })

    await run({ name: 'undo', params: {} })
    expect(shape()).toMatchObject({ radius: 20 })
    await run({ name: 'redo', params: {} })
    expect(shape()).toMatchObject({ radius: 34 })
    expect(state().canRedo).toBe(false)
  })

  it('restores the starting state on cancel and leaves no undo step', async () => {
    const { run, shape } = setup()
    await run({ name: 'organic.add', params: { kind: 'sphere' } })
    await run({ name: 'edit.begin', params: {} })
    await run(drag(90))
    await run({ name: 'edit.cancel', params: {} })
    expect(shape()).toMatchObject({ radius: 20 })
    await run({ name: 'undo', params: {} })
    expect(await run({ name: 'undo', params: {} })).toEqual({ ok: false, error: 'Nothing to undo' })
  })

  it('records nothing for an edit that changed nothing', async () => {
    const { run, state } = setup()
    await run({ name: 'edit.begin', params: {} })
    await run({ name: 'edit.commit', params: {} })
    expect(state().canUndo).toBe(false)
  })

  it('refuses to nest, and to commit or cancel when none is open', async () => {
    const { run } = setup()
    expect(await run({ name: 'edit.commit', params: {} })).toEqual({
      ok: false,
      error: 'No live edit is open',
    })
    expect(await run({ name: 'edit.cancel', params: {} })).toMatchObject({ ok: false })
    await run({ name: 'edit.begin', params: {} })
    expect(await run({ name: 'edit.begin', params: {} })).toEqual({
      ok: false,
      error: 'A live edit is already open',
    })
  })

  it('closes an open edit as its own step when undo arrives mid-edit', async () => {
    const { run, shape } = setup()
    await run({ name: 'organic.add', params: { kind: 'sphere' } })
    await run({ name: 'edit.begin', params: {} })
    await run(drag(33))
    await run({ name: 'undo', params: {} })
    expect(shape()).toMatchObject({ radius: 20 })
    await run({ name: 'redo', params: {} })
    expect(shape()).toMatchObject({ radius: 33 })
    // The edit is closed, so the next change is an ordinary step again.
    expect(await run({ name: 'edit.commit', params: {} })).toMatchObject({ ok: false })
  })
})
