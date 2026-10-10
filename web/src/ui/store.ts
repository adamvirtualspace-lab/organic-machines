import { create } from 'zustand'
import type { BooleanKind } from '@/protocol'

const MAX_LOG_LINES = 300

export type LogKind = 'input' | 'info' | 'error'

export interface LogLine {
  id: number
  kind: LogKind
  text: string
}

/** UI-only state. Anything about the document lives in the engine, not here. */
interface UiStore {
  consoleOpen: boolean
  statsOpen: boolean
  /** How the next primitive joins the selected shape. */
  combine: BooleanKind
  logLines: readonly LogLine[]
  toggleConsole(): void
  showConsole(): void
  toggleStats(): void
  setCombine(combine: BooleanKind): void
  log(kind: LogKind, text: string): void
}

let nextLogId = 1

export const useUi = create<UiStore>((set) => ({
  consoleOpen: false,
  statsOpen: import.meta.env.DEV,
  combine: 'union',
  logLines: [],
  toggleConsole: () => set((s) => ({ consoleOpen: !s.consoleOpen })),
  showConsole: () => set({ consoleOpen: true }),
  toggleStats: () => set((s) => ({ statsOpen: !s.statsOpen })),
  setCombine: (combine) => set({ combine }),
  log: (kind, text) =>
    set((s) => ({
      logLines: [...s.logLines, { id: nextLogId++, kind, text }].slice(-MAX_LOG_LINES),
    })),
}))
