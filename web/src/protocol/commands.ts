import { MODES, VIEWS, type Mode, type ViewName } from './types'

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
}

export type CommandName = keyof CommandParams

export type Command<K extends CommandName = CommandName> = {
  [N in K]: { name: N; params: CommandParams[N] }
}[K]

export type CommandResult = { ok: true } | { ok: false; error: string }

export type ParamSpec =
  | { type: 'string'; optional?: boolean }
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
}

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMAND_SPECS, name)
}
