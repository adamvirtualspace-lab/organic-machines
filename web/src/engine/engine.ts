import {
  MODES,
  type CommandName,
  type CommandParams,
  type EngineApi,
  type EngineState,
  type EngineStats,
  type EventMap,
  type EventName,
  type LogMessage,
  type Mode,
  type QueryMap,
  type ViewName,
} from '../protocol'
import { emptyDocument, type DocObject, type Document } from './doc/document'
import { History } from './doc/history'
import { CommandError } from './errors'
import { deserializeDocument, serializeDocument } from './io/serialize'
import { demoScene } from './organic/demos'
import { setTreeParam } from './organic/tree'

type ViewStats = Omit<EngineStats, 'jsHeapBytes' | 'wasmHeapBytes'>

/** What the viewport contributes when one is attached. Absent in the headless CLI. */
export interface ViewDelegate {
  home(): void
  setView(view: ViewName): void
  flipView(): void
  /** Called once on attach and then whenever the document or the editing mode changes. */
  sceneChanged(doc: Document, mode: Mode): void
  bench(): Promise<readonly LogMessage[]>
  selfTest(): Promise<readonly LogMessage[]>
  stats(): ViewStats
}

export interface Engine extends EngineApi {
  /** Returns the function that detaches this delegate, which does nothing if a newer one took over. */
  attachView(delegate: ViewDelegate): () => void
}

const MODE_LABEL: Record<Mode, string> = { organic: 'Organic', machines: 'Machines' }
const NO_VIEW_STATS: ViewStats = {
  frameMs: null,
  gpuBytesEstimate: null,
  sdfScale: null,
  shaderBuilds: null,
  shaderBuildMs: null,
}

/** Creates the engine core. It has no DOM or rendering dependency, so it also runs in Node. */
export function createEngine(): Engine {
  let doc = emptyDocument()
  let mode: Mode = 'organic'
  let view: ViewDelegate | null = null
  const history = new History<Document>()
  const listeners: { [K in EventName]: Set<(payload: EventMap[K]) => void> } = {
    'state.changed': new Set(),
    log: new Set(),
  }

  const snapshot = (): EngineState => ({
    mode,
    objects: doc.objects,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  })
  let state = snapshot()

  function change(next: Document): void {
    history.record(doc, next)
    doc = next
  }

  function viewport(): ViewDelegate {
    if (!view) throw new CommandError('No viewport is attached')
    return view
  }

  function report(messages: readonly LogMessage[]): void {
    for (const message of messages) for (const listener of listeners.log) listener(message)
  }

  /** Finds an object, refusing ones that belong to the other mode. */
  function editable(id: string): DocObject {
    const object = doc.objects.find((o) => o.id === id)
    if (!object) throw new CommandError(`There is no object "${id}"`)
    if (object.mode !== mode) {
      throw new CommandError(
        `"${object.name}" belongs to ${MODE_LABEL[object.mode]} mode. Switch modes to edit it.`,
      )
    }
    return object
  }

  const replace = (target: DocObject, next: DocObject): Document => ({
    ...doc,
    objects: doc.objects.map((o) => (o === target ? next : o)),
  })

  // Handlers throw CommandError before changing anything, so a failed command changes nothing.
  const handlers: { [K in CommandName]: (params: CommandParams[K]) => void | Promise<void> } = {
    'mode.set': ({ mode: next }) => {
      if (!MODES.includes(next)) throw new CommandError(`Unknown mode "${String(next)}"`)
      mode = next
    },
    'object.add': ({ name }) => {
      const object: DocObject = {
        id: `o${doc.nextId}`,
        name: name || `${MODE_LABEL[mode]} ${doc.nextId}`,
        mode,
      }
      change({ ...doc, nextId: doc.nextId + 1, objects: [...doc.objects, object] })
    },
    'object.remove': ({ id }) => {
      const target = editable(id)
      change({ ...doc, objects: doc.objects.filter((o) => o !== target) })
    },
    'object.rename': ({ id, name }) => {
      const target = editable(id)
      if (!name.trim()) throw new CommandError('A name cannot be empty')
      change(replace(target, { ...target, name: name.trim() }))
    },
    'doc.new': () => {
      doc = emptyDocument()
      history.clear()
    },
    'doc.load': ({ data }) => {
      doc = deserializeDocument(data)
      history.clear()
    },
    undo: () => {
      const previous = history.undo()
      if (!previous) throw new CommandError('Nothing to undo')
      doc = previous
    },
    redo: () => {
      const next = history.redo()
      if (!next) throw new CommandError('Nothing to redo')
      doc = next
    },
    'view.home': () => viewport().home(),
    'view.set': ({ view: name }) => viewport().setView(name),
    'view.flip': () => viewport().flipView(),
    'demo.scene': ({ name }) => {
      const objects = demoScene(name).map((object, index): DocObject => ({
        id: `o${index + 1}`,
        mode: 'organic',
        ...object,
      }))
      change({ ...doc, nextId: objects.length + 1, objects })
    },
    'organic.set': ({ id, node, param, value }) => {
      const target = editable(id)
      if (!target.sdf) throw new CommandError(`"${target.name}" has no shape to edit`)
      change(replace(target, { ...target, sdf: setTreeParam(target.sdf, node, param, value) }))
    },
    'bench.run': async () => report(await viewport().bench()),
    'selftest.sdf': async () => report(await viewport().selfTest()),
  }

  const queries: { [K in keyof QueryMap]: () => QueryMap[K] } = {
    state: () => state,
    stats: () => ({
      ...(view?.stats() ?? NO_VIEW_STATS),
      jsHeapBytes: jsHeapBytes(),
      wasmHeapBytes: 0, // No WASM modules are loaded until the OCCT worker arrives in M1.
    }),
    'doc.serialize': () => serializeDocument(doc),
  }

  return {
    async execute(command) {
      if (!Object.hasOwn(handlers, command.name)) {
        return { ok: false, error: `Unknown command "${String(command.name)}"` }
      }
      const handler = handlers[command.name] as (params: unknown) => void | Promise<void>
      const before = doc
      const modeBefore = mode
      try {
        await handler(command.params)
      } catch (error) {
        if (error instanceof CommandError) return { ok: false, error: error.message }
        throw error
      }
      if (doc !== before || mode !== modeBefore) view?.sceneChanged(doc, mode)
      state = snapshot()
      for (const listener of listeners['state.changed']) listener(state)
      return { ok: true }
    },
    query: (name) => queries[name](),
    subscribe(event, listener) {
      listeners[event].add(listener)
      return () => listeners[event].delete(listener)
    },
    attachView(delegate) {
      view = delegate
      delegate.sceneChanged(doc, mode)
      return () => {
        if (view === delegate) view = null
      }
    },
  }
}

/** Chrome-only; other environments report null. */
function jsHeapBytes(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory?.usedJSHeapSize ?? null
}
