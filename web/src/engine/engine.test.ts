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

  it('keeps the current document when a load fails', async () => {
    const engine = createEngine()
    await engine.execute({ name: 'object.add', params: { name: 'Keep me' } })
    const result = await engine.execute({ name: 'doc.load', params: { data: 'not json' } })
    expect(result).toEqual({ ok: false, error: 'This file is not valid JSON' })
    expect(engine.query('state').objects).toHaveLength(1)
  })
})
