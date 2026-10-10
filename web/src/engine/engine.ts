import {
  findNode,
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
  type PrimitiveKind,
  type QueryMap,
  type SdfTree,
  type Selection,
  type Vec3,
  type ViewName,
} from '../protocol'
import { emptyDocument, type DocObject, type Document } from './doc/document'
import { History } from './doc/history'
import { CommandError } from './errors'
import { deserializeDocument, serializeDocument } from './io/serialize'
import { demoScene } from './organic/demos'
import {
  addShape,
  moveNode,
  newPrimitive,
  nextNodeId,
  removeNode,
  renameNode,
  setBooleanKind,
  setMirrorAxis,
  setNodeHidden,
  setTreeParam,
  wrapNode,
} from './organic/tree'

type ViewStats = Omit<EngineStats, 'jsHeapBytes' | 'wasmHeapBytes'>

/** What the viewport needs to know to draw: handed over whenever any part of it changes. */
export interface SceneState {
  readonly doc: Document
  readonly mode: Mode
  readonly selection: Selection | null
}

/** What the viewport contributes when one is attached. Absent in the headless CLI. */
export interface ViewDelegate {
  home(): void
  setView(view: ViewName): void
  flipView(): void
  /** Called once on attach and then whenever the document, mode or selection changes. */
  sceneChanged(scene: SceneState): void
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

const PRIMITIVE_LABEL: Record<PrimitiveKind, string> = {
  sphere: 'Sphere',
  box: 'Box',
  roundBox: 'Round box',
  cylinder: 'Cylinder',
  capsule: 'Capsule',
  torus: 'Torus',
  cone: 'Cone',
  plane: 'Plane',
}
/** Height of each default primitive's centre when it rests on the ground. */
const RESTING_HEIGHT: Record<PrimitiveKind, number> = {
  sphere: 20,
  box: 20,
  roundBox: 20,
  cylinder: 20,
  capsule: 25,
  torus: 8,
  cone: 20,
  plane: 0,
}
/** A shape added to an existing one starts this far above it, so it is not buried inside. */
const ADDED_SHAPE_LIFT = 30

/** Creates the engine core. It has no DOM or rendering dependency, so it also runs in Node. */
export function createEngine(): Engine {
  let doc = emptyDocument()
  let mode: Mode = 'organic'
  let selection: Selection | null = null
  /** The document as it was when a live edit began; null when none is open. */
  let editStart: Document | null = null
  let view: ViewDelegate | null = null
  const history = new History<Document>()
  const listeners: { [K in EventName]: Set<(payload: EventMap[K]) => void> } = {
    'state.changed': new Set(),
    log: new Set(),
  }

  const snapshot = (): EngineState => ({
    mode,
    objects: doc.objects,
    selection,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  })
  let state = snapshot()

  /** During a live edit changes only preview; committing the edit records them as one step. */
  function change(next: Document): void {
    if (!editStart) history.record(doc, next)
    doc = next
  }

  /** Commands that rewind or replace the document first close any live edit as its own step. */
  function finishEdit(): void {
    if (editStart && editStart !== doc) history.record(editStart, doc)
    editStart = null
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

  /** Finds an editable object that has a shape. */
  function shaped(id: string): DocObject & { sdf: SdfTree } {
    const object = editable(id)
    if (!object.sdf) throw new CommandError(`"${object.name}" has no shape to edit`)
    return object as DocObject & { sdf: SdfTree }
  }

  const replace = (target: DocObject, next: DocObject): Document => ({
    ...doc,
    objects: doc.objects.map((o) => (o === target ? next : o)),
  })

  /** Applies a change to one object's shape. */
  function reshape(id: string, edit: (sdf: SdfTree) => SdfTree): void {
    const target = shaped(id)
    change(replace(target, { ...target, sdf: edit(target.sdf) }))
  }

  /** Drops or repairs a selection the document no longer backs, e.g. after undo or a removal. */
  function validSelection(): Selection | null {
    if (!selection) return null
    const object = doc.objects.find((o) => o.id === selection!.object)
    if (!object || object.mode !== mode) return null
    if (!object.sdf) return selection.node === undefined ? selection : { object: object.id }
    if (selection.node && findNode(object.sdf, selection.node)) return selection
    return { object: object.id, node: object.sdf.id }
  }

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
      editStart = null
      doc = emptyDocument()
      history.clear()
    },
    'doc.load': ({ data }) => {
      const loaded = deserializeDocument(data)
      editStart = null
      doc = loaded
      history.clear()
    },
    undo: () => {
      finishEdit()
      const previous = history.undo()
      if (!previous) throw new CommandError('Nothing to undo')
      doc = previous
    },
    redo: () => {
      finishEdit()
      const next = history.redo()
      if (!next) throw new CommandError('Nothing to redo')
      doc = next
    },
    'view.home': () => viewport().home(),
    'view.set': ({ view: name }) => viewport().setView(name),
    'view.flip': () => viewport().flipView(),
    'demo.scene': ({ name }) => {
      finishEdit()
      const objects = demoScene(name).map((object, index): DocObject => ({
        id: `o${index + 1}`,
        mode: 'organic',
        ...object,
      }))
      change({ ...doc, nextId: objects.length + 1, objects })
    },
    'organic.add': ({ kind, op = 'union', id, node }) => {
      if (id === undefined) {
        if (mode !== 'organic') throw new CommandError('Switch to Organic mode to add shapes')
        const object: DocObject = {
          id: `o${doc.nextId}`,
          name: PRIMITIVE_LABEL[kind],
          mode: 'organic',
          sdf: newPrimitive(kind, 'n1', [0, 0, RESTING_HEIGHT[kind]]),
        }
        change({ ...doc, nextId: doc.nextId + 1, objects: [...doc.objects, object] })
        selection = { object: object.id, node: 'n1' }
        return
      }
      const target = editable(id)
      if (target.mode !== 'organic') {
        throw new CommandError('Shapes can only be added to Organic objects')
      }
      if (!target.sdf) {
        const sdf = newPrimitive(kind, 'n1', [0, 0, RESTING_HEIGHT[kind]])
        change(replace(target, { ...target, sdf }))
        selection = { object: id, node: 'n1' }
        return
      }
      const anchor = findNode(target.sdf, node ?? target.sdf.id)
      if (!anchor) throw new CommandError(`There is no node "${node}"`)
      // A shape joining a boolean sits in that boolean's space; otherwise it shares the anchor's.
      const [x, y, z]: Vec3 = anchor.kind === op ? [0, 0, 0] : anchor.position
      const shapeId = nextNodeId(target.sdf)
      const groupId = `n${Number(shapeId.slice(1)) + 1}`
      const shape = newPrimitive(kind, shapeId, [x, y, z + ADDED_SHAPE_LIFT])
      const sdf = addShape(target.sdf, anchor.id, op, shape, groupId)
      change(replace(target, { ...target, sdf }))
      selection = { object: id, node: shapeId }
    },
    'organic.remove': ({ id, node }) => {
      const target = shaped(id)
      const sdf = removeNode(target.sdf, node)
      // An object with no shapes left has nothing to show, so it goes too.
      change(
        sdf
          ? replace(target, { ...target, sdf })
          : { ...doc, objects: doc.objects.filter((o) => o !== target) },
      )
    },
    'organic.move': ({ id, node, by }) => reshape(id, (sdf) => moveNode(sdf, node, by)),
    'organic.wrap': ({ id, node, kind }) => {
      const modifierId = nextNodeId(shaped(id).sdf)
      reshape(id, (sdf) => wrapNode(sdf, node, kind, modifierId))
      selection = { object: id, node: modifierId }
    },
    'organic.rename': ({ id, node, name }) => reshape(id, (sdf) => renameNode(sdf, node, name)),
    'organic.hide': ({ id, node, hidden }) =>
      reshape(id, (sdf) => setNodeHidden(sdf, node, hidden)),
    'organic.op': ({ id, node, op }) => reshape(id, (sdf) => setBooleanKind(sdf, node, op)),
    'organic.axis': ({ id, node, axis }) => reshape(id, (sdf) => setMirrorAxis(sdf, node, axis)),
    'organic.set': ({ id, node, param, value }) =>
      reshape(id, (sdf) => setTreeParam(sdf, node, param, value)),
    select: ({ id, node }) => {
      const object = editable(id)
      if (node !== undefined && !(object.sdf && findNode(object.sdf, node))) {
        throw new CommandError(`There is no node "${node}"`)
      }
      selection = object.sdf ? { object: id, node: node ?? object.sdf.id } : { object: id }
    },
    'select.clear': () => {
      selection = null
    },
    'edit.begin': () => {
      if (editStart) throw new CommandError('A live edit is already open')
      editStart = doc
    },
    'edit.commit': () => {
      if (!editStart) throw new CommandError('No live edit is open')
      finishEdit()
    },
    'edit.cancel': () => {
      if (!editStart) throw new CommandError('No live edit is open')
      doc = editStart
      editStart = null
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

  const scene = (): SceneState => ({ doc, mode, selection })

  return {
    async execute(command) {
      if (!Object.hasOwn(handlers, command.name)) {
        return { ok: false, error: `Unknown command "${String(command.name)}"` }
      }
      const handler = handlers[command.name] as (params: unknown) => void | Promise<void>
      const before = scene()
      try {
        await handler(command.params)
      } catch (error) {
        if (error instanceof CommandError) return { ok: false, error: error.message }
        throw error
      }
      selection = validSelection()
      if (doc !== before.doc || mode !== before.mode || selection !== before.selection) {
        view?.sceneChanged(scene())
      }
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
      delegate.sceneChanged(scene())
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
