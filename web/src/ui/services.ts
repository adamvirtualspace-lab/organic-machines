import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import {
  findNode,
  formatCommand,
  type Command,
  type CommandResult,
  type EngineApi,
  type EngineState,
  type ObjectInfo,
  type SdfTree,
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

/** The selected object and, when it has a shape, the selected node of it. */
export function useSelected(): { object: ObjectInfo; node: SdfTree | undefined } | null {
  const { objects, selection } = useEngineState()
  const object = selection && objects.find((o) => o.id === selection.object)
  if (!object) return null
  const node = object.sdf && selection.node ? findNode(object.sdf, selection.node) : undefined
  return { object, node }
}

export type Run = (command: Command, options?: { quiet?: boolean }) => Promise<CommandResult>

/**
 * Runs a command and echoes its text form to the console, so every click shows its command.
 * `quiet` skips the echo, for the stream of updates a drag sends. A failure always shows,
 * and opens the console so it is not missed.
 */
export function useRun(): Run {
  const { engine } = useServices()
  return useCallback(
    async (command, options) => {
      const { log, showConsole } = useUi.getState()
      // Echoed first, so output a command reports while it runs lands underneath it.
      if (!options?.quiet) log('input', formatCommand(command))
      const result = await engine.execute(command)
      if (!result.ok) {
        if (options?.quiet) log('input', formatCommand(command))
        log('error', result.error)
        showConsole()
      }
      return result
    },
    [engine],
  )
}
