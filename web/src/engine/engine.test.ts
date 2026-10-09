import { describe, expect, it, vi } from 'vitest'
import type { EngineState } from '../protocol'
import { createEngine } from './engine'

describe('engine', () => {
  it('starts in Organic mode with an empty document', () => {
    expect(createEngine().query('state')).toEqual({
      mode: 'organic',
      objects: [],
      canUndo: false,
      canRedo: false,
    })
  })

  it('switches mode and tells subscribers', async () => {
    const engine = createEngine()
    const seen: EngineState[] = []
    const unsubscribe = engine.subscribe('state.changed', (state) => seen.push(state))

    expect(await engine.execute({ name: 'mode.set', params: { mode: 'machines' } })).toEqual({
      ok: true,
    })
    expect(seen.map((s) => s.mode)).toEqual(['machines'])

    unsubscribe()
    await engine.execute({ name: 'mode.set', params: { mode: 'organic' } })
    expect(seen).toHaveLength(1)
  })

  it('creates objects in the current mode', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: {} })
    await engine.execute({ name: 'mode.set', params: { mode: 'machines' } })
    await engine.execute({ name: 'object.add', params: { name: 'Bracket' } })

    expect(engine.query('state').objects).toEqual([
      { id: 'o1', name: 'Organic 1', mode: 'organic' },
      { id: 'o2', name: 'Bracket', mode: 'machines' },
    ])
  })

  it('refuses to edit an object from the other mode, and changes nothing', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: { name: 'Blob' } })
    await engine.execute({ name: 'mode.set', params: { mode: 'machines' } })
    const before = engine.query('state')
    const listener = vi.fn()
    engine.subscribe('state.changed', listener)

    const result = await engine.execute({ name: 'object.remove', params: { id: 'o1' } })

    expect(result).toEqual({
      ok: false,
      error: '"Blob" belongs to Organic mode. Switch modes to edit it.',
    })
    expect(engine.query('state')).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('undoes and redoes document changes, but not mode switches', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: { name: 'Blob' } })
    await engine.execute({ name: 'object.rename', params: { id: 'o1', name: 'Head' } })
    await engine.execute({ name: 'mode.set', params: { mode: 'machines' } })

    await engine.execute({ name: 'undo', params: {} })
    expect(engine.query('state')).toMatchObject({
      mode: 'machines',
      objects: [{ id: 'o1', name: 'Blob' }],
      canRedo: true,
    })

    await engine.execute({ name: 'undo', params: {} })
    expect(engine.query('state')).toMatchObject({ objects: [], canUndo: false })
    expect(await engine.execute({ name: 'undo', params: {} })).toEqual({
      ok: false,
      error: 'Nothing to undo',
    })

    await engine.execute({ name: 'redo', params: {} })
    await engine.execute({ name: 'redo', params: {} })
    expect(engine.query('state').objects).toEqual([{ id: 'o1', name: 'Head', mode: 'organic' }])
  })

  it('drops the redo stack when a new change is made', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: {} })
    await engine.execute({ name: 'undo', params: {} })
    await engine.execute({ name: 'object.add', params: {} })
    expect(engine.query('state').canRedo).toBe(false)
  })

  it('reports that view commands need a viewport when running headless', async () => {
    expect(await createEngine().execute({ name: 'view.home', params: {} })).toEqual({
      ok: false,
      error: 'No viewport is attached',
    })
  })

  it('loads what it serialised, and clears undo', async () => {
    const source = createEngine()
    await source.execute({ name: 'object.add', params: { name: 'Blob' } })
    const data = source.query('doc.serialize')

    const target = createEngine()
    await target.execute({ name: 'object.add', params: { name: 'Scrap' } })
    expect(await target.execute({ name: 'doc.load', params: { data } })).toEqual({ ok: true })
    expect(target.query('state')).toMatchObject({
      objects: [{ id: 'o1', name: 'Blob', mode: 'organic' }],
      canUndo: false,
    })
  })

  it('loads a demo scene as Organic objects, undoably', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: { name: 'Mine' } })
    expect(await engine.execute({ name: 'demo.scene', params: { name: 'test' } })).toEqual({
      ok: true,
    })
    expect(engine.query('state').objects.map((o) => [o.id, o.name, o.mode])).toEqual([
      ['o1', 'Carved block', 'organic'],
      ['o2', 'Ring', 'organic'],
    ])
    await engine.execute({ name: 'undo', params: {} })
    expect(engine.query('state').objects.map((o) => o.name)).toEqual(['Mine'])
  })

  it('edits a shape value, undoes it, and refuses to edit from the other mode', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'demo.scene', params: { name: 'test' } })
    const radius = () => JSON.parse(engine.query('doc.serialize')).objects[0].sdf.children[1].radius
    const set = { id: 'o1', node: 'n3', param: 'radius', value: 20 }

    expect(await engine.execute({ name: 'organic.set', params: set })).toEqual({ ok: true })
    expect(radius()).toBe(20)
    await engine.execute({ name: 'undo', params: {} })
    expect(radius()).toBe(38)

    await engine.execute({ name: 'mode.set', params: { mode: 'machines' } })
    expect(await engine.execute({ name: 'organic.set', params: set })).toEqual({
      ok: false,
      error: '"Carved block" belongs to Organic mode. Switch modes to edit it.',
    })
    expect(radius()).toBe(38)
  })

  it('refuses to edit the shape of an object that has none', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: { name: 'Empty' } })
    const params = { id: 'o1', node: 'n1', param: 'radius', value: 1 }
    expect(await engine.execute({ name: 'organic.set', params })).toEqual({
      ok: false,
      error: '"Empty" has no shape to edit',
    })
  })

  it('tells an attached view about the document, and only when it changes', async () => {
    const engine = createEngine()
    const seen: number[] = []
    const detach = engine.attachView({
      home: () => {},
      setView: () => {},
      flipView: () => {},
      documentChanged: (doc) => seen.push(doc.objects.length),
      bench: async () => [{ kind: 'info', text: 'benched' }],
      selfTest: async () => [],
      stats: () => ({
        frameMs: 1,
        gpuBytesEstimate: 2,
        sdfScale: 1,
        shaderBuilds: 3,
        shaderBuildMs: 4,
      }),
    })
    expect(seen).toEqual([0])

    await engine.execute({ name: 'object.add', params: {} })
    await engine.execute({ name: 'mode.set', params: { mode: 'machines' } })
    await engine.execute({ name: 'view.home', params: {} })
    expect(seen).toEqual([0, 1])
    expect(engine.query('stats')).toMatchObject({ frameMs: 1, shaderBuilds: 3, wasmHeapBytes: 0 })

    const logged: string[] = []
    engine.subscribe('log', (message) => logged.push(message.text))
    await engine.execute({ name: 'bench.run', params: {} })
    expect(logged).toEqual(['benched'])

    detach()
    expect(await engine.execute({ name: 'bench.run', params: {} })).toEqual({
      ok: false,
      error: 'No viewport is attached',
    })
  })

  it('keeps the current document when a load fails', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: { name: 'Keep me' } })
    const result = await engine.execute({ name: 'doc.load', params: { data: 'not json' } })
    expect(result).toEqual({ ok: false, error: 'This file is not valid JSON' })
    expect(engine.query('state').objects).toHaveLength(1)
  })
})
