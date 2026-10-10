import {
  AXES,
  BOOLEAN_KINDS,
  MODIFIER_KINDS,
  PRIMITIVE_KINDS,
  type Axis,
  type BooleanKind,
  type ModifierKind,
  type PrimitiveKind,
} from './shapes'
import { DEMO_SCENES, MODES, VIEWS, type DemoScene, type Mode, type ViewName } from './types'

type NoParams = Record<never, never>

/** Every command the engine accepts, with its parameters. This is the UI/engine contract. */
export interface CommandParams {
  'mode.set': { mode: Mode }
  'object.add': { name?: string }
  'object.remove': { id: string }
  'object.rename': { id: string; name: string }
  'doc.new': NoParams
  'doc.load': { data: string }
  undo: NoParams
  redo: NoParams
  'view.home': NoParams
  'view.set': { view: ViewName }
  'view.flip': NoParams
  'demo.scene': { name: DemoScene }
  /** Adds a primitive: to object `id` at `node` (default: its root), or as a new object. */
  'organic.add': { kind: PrimitiveKind; op?: BooleanKind; id?: string; node?: string }
  'organic.remove': { id: string; node: string }
  'organic.move': { id: string; node: string; by: number }
  'organic.wrap': { id: string; node: string; kind: ModifierKind }
  'organic.rename': { id: string; node: string; name: string }
  'organic.hide': { id: string; node: string; hidden: boolean }
  'organic.op': { id: string; node: string; op: BooleanKind }
  'organic.axis': { id: string; node: string; axis: Axis }
  'organic.set': { id: string; node: string; param: string; value: number }
  select: { id: string; node?: string }
  'select.clear': NoParams
  /** Between begin and commit, changes preview live and then become a single undo step. */
  'edit.begin': NoParams
  'edit.commit': NoParams
  'edit.cancel': NoParams
  'bench.run': NoParams
  'selftest.sdf': NoParams
}

export type CommandName = keyof CommandParams

export type Command<K extends CommandName = CommandName> = {
  [N in K]: { name: N; params: CommandParams[N] }
}[K]

export type CommandResult = { ok: true } | { ok: false; error: string }

export type ParamSpec =
  | { type: 'string'; optional?: boolean }
  | { type: 'number'; optional?: boolean }
  | { type: 'boolean'; optional?: boolean }
  | { type: 'enum'; values: readonly string[]; optional?: boolean }

export interface CommandSpec {
  summary: string
  params: Record<string, ParamSpec>
  /** Parameter names that bare (non key=value) words in the text form fill, in order. */
  positional?: readonly string[]
}

/** Runtime description of each command, used for the text form, help and validation. */
export const COMMAND_SPECS: {
  [K in CommandName]: CommandSpec & {
    params: { [P in keyof Required<CommandParams[K]>]: ParamSpec }
  }
} = {
  'mode.set': {
    summary: 'Switch between Organic and Machines mode',
    params: { mode: { type: 'enum', values: MODES } },
    positional: ['mode'],
  },
  'object.add': {
    summary: 'Add an empty object in the current mode',
    params: { name: { type: 'string', optional: true } },
    positional: ['name'],
  },
  'object.remove': {
    summary: 'Remove an object',
    params: { id: { type: 'string' } },
    positional: ['id'],
  },
  'object.rename': {
    summary: 'Rename an object',
    params: { id: { type: 'string' }, name: { type: 'string' } },
    positional: ['id', 'name'],
  },
  'doc.new': { summary: 'Start an empty document', params: {} },
  'doc.load': {
    summary: 'Replace the document with a saved one',
    params: { data: { type: 'string' } },
  },
  undo: { summary: 'Undo the last change', params: {} },
  redo: { summary: 'Redo the last undone change', params: {} },
  'view.home': { summary: 'Reset the camera', params: {} },
  'view.set': {
    summary: 'Look at the scene from one side',
    params: { view: { type: 'enum', values: VIEWS } },
    positional: ['view'],
  },
  'view.flip': { summary: 'Look from the opposite side', params: {} },
  'demo.scene': {
    summary: 'Replace the document with a built-in Organic scene',
    params: { name: { type: 'enum', values: DEMO_SCENES } },
    positional: ['name'],
  },
  'organic.add': {
    summary: 'Add a primitive: to object id (at node, combined by op), or as a new object',
    params: {
      kind: { type: 'enum', values: PRIMITIVE_KINDS },
      op: { type: 'enum', values: BOOLEAN_KINDS, optional: true },
      id: { type: 'string', optional: true },
      node: { type: 'string', optional: true },
    },
    positional: ['kind', 'op', 'id', 'node'],
  },
  'organic.remove': {
    summary: 'Remove a shape node',
    params: { id: { type: 'string' }, node: { type: 'string' } },
    positional: ['id', 'node'],
  },
  'organic.move': {
    summary: 'Move a shape node earlier (by=-1) or later (by=1) among its siblings',
    params: { id: { type: 'string' }, node: { type: 'string' }, by: { type: 'number' } },
    positional: ['id', 'node', 'by'],
  },
  'organic.wrap': {
    summary: 'Put a modifier around a shape node',
    params: {
      id: { type: 'string' },
      node: { type: 'string' },
      kind: { type: 'enum', values: MODIFIER_KINDS },
    },
    positional: ['id', 'node', 'kind'],
  },
  'organic.rename': {
    summary: 'Name a shape node (an empty name clears it)',
    params: { id: { type: 'string' }, node: { type: 'string' }, name: { type: 'string' } },
    positional: ['id', 'node', 'name'],
  },
  'organic.hide': {
    summary: 'Hide or show a shape node',
    params: { id: { type: 'string' }, node: { type: 'string' }, hidden: { type: 'boolean' } },
    positional: ['id', 'node', 'hidden'],
  },
  'organic.op': {
    summary: 'Change how a boolean node combines its shapes',
    params: {
      id: { type: 'string' },
      node: { type: 'string' },
      op: { type: 'enum', values: BOOLEAN_KINDS },
    },
    positional: ['id', 'node', 'op'],
  },
  'organic.axis': {
    summary: 'Change the axis of a mirror node',
    params: {
      id: { type: 'string' },
      node: { type: 'string' },
      axis: { type: 'enum', values: AXES },
    },
    positional: ['id', 'node', 'axis'],
  },
  'organic.set': {
    summary: 'Change one number of an Organic shape, e.g. node=n3 param=radius or param=position.x',
    params: {
      id: { type: 'string' },
      node: { type: 'string' },
      param: { type: 'string' },
      value: { type: 'number' },
    },
    positional: ['id', 'node', 'param', 'value'],
  },
  select: {
    summary: 'Select an object, or one node of its shape',
    params: { id: { type: 'string' }, node: { type: 'string', optional: true } },
    positional: ['id', 'node'],
  },
  'select.clear': { summary: 'Select nothing', params: {} },
  'edit.begin': { summary: 'Start a live edit: changes preview until committed', params: {} },
  'edit.commit': { summary: 'Finish a live edit as one undo step', params: {} },
  'edit.cancel': { summary: 'Abandon a live edit and restore what was there', params: {} },
  'bench.run': { summary: 'Measure frame time while orbiting the current scene', params: {} },
  'selftest.sdf': { summary: 'Check the SDF shader against the conformance vectors', params: {} },
}

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMAND_SPECS, name)
}
