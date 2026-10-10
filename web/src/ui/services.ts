import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import {
  formatCommand,
  type Command,
  type CommandResult,
  type EngineApi,
  type EngineState,
  type ViewportHost,
} from '@/protocol'
import { useUi } from './store'

/** Everything the UI may touch outside itself. The app entry point supplies the real ones. */
export interface Services {
  engine: EngineApi
  viewport: ViewportHost
}

export const ServicesContext = createContext<Services | null>(null)

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (!services) throw new Error('ServicesContext is missing')
  return services
}

/** The engine is the source of truth; this just re-renders when it reports a change. */
export function useEngineState(): EngineState {
  const { engine } = useServices()
  const subscribe = useCallback(
    (onChange: () => void) => engine.subscribe('state.changed', onChange),
    [engine],
  )
  return useSyncExternalStore(subscribe, () => engine.query('state'))
}

/** Runs a command and echoes its text form to the console, so every click shows its command. */
export function useRun(): (command: Command) => Promise<CommandResult> {
  const { engine } = useServices()
  return useCallback(
    async (command) => {
      const { log } = useUi.getState()
      // Echoed first, so output a command reports while it runs lands underneath it.
      log('input', formatCommand(command))
      const result = await engine.execute(command)
      if (!result.ok) log('error', result.error)
      return result
    },
    [engine],
  )
}
