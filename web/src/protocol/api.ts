import type { Command, CommandResult } from './commands'
import type { EngineState, EngineStats, LogMessage } from './types'

export interface EventMap {
  'state.changed': EngineState
  /** Output from long-running commands such as benchmarks, for the console. */
  log: LogMessage
}
export type EventName = keyof EventMap

export interface QueryMap {
  state: EngineState
  stats: EngineStats
  /** The document as save-file text. */
  'doc.serialize': string
}
export type QueryName = keyof QueryMap

/** The whole interface between the UI and the engine. */
export interface EngineApi {
  execute(command: Command): Promise<CommandResult>
  query<K extends QueryName>(name: K): QueryMap[K]
  /** Returns the function that unsubscribes. */
  subscribe<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void): () => void
}

export type ViewportSupport = { ok: true } | { ok: false; reason: string }

/** Lets the UI give the engine a place to draw, without seeing any rendering code. */
export interface ViewportHost {
  checkSupport(): Promise<ViewportSupport>
  /** The engine creates its canvas inside `container`. Returns the function that detaches it. */
  attach(container: HTMLElement): () => void
}
