import { create } from 'zustand'

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
  logLines: readonly LogLine[]
  toggleConsole(): void
  toggleStats(): void
  log(kind: LogKind, text: string): void
}

let nextLogId = 1

export const useUi = create<UiStore>((set) => ({
  consoleOpen: false,
  statsOpen: import.meta.env.DEV,
  logLines: [],
  toggleConsole: () => set((s) => ({ consoleOpen: !s.consoleOpen })),
  toggleStats: () => set((s) => ({ statsOpen: !s.statsOpen })),
  log: (kind, text) =>
    set((s) => ({
      logLines: [...s.logLines, { id: nextLogId++, kind, text }].slice(-MAX_LOG_LINES),
    })),
}))
