import { useEffect } from 'react'
import { CommandConsole } from './CommandConsole'
import { ObjectTree } from './ObjectTree'
import { PropertiesPanel } from './PropertiesPanel'
import { useServices } from './services'
import { StatsOverlay } from './StatsOverlay'
import { useUi } from './store'
import { Toolbar } from './Toolbar'
import { TopBar } from './TopBar'
import { Viewport } from './Viewport'

export function App() {
  const consoleOpen = useUi((s) => s.consoleOpen)
  const statsOpen = useUi((s) => s.statsOpen)
  const log = useUi((s) => s.log)
  const { engine } = useServices()

  // Long-running commands such as benchmarks report through the engine's log.
  useEffect(
    () => engine.subscribe('log', (message) => log(message.kind, message.text)),
    [engine, log],
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-xs text-foreground select-none">
      <TopBar />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {/* Side panels sit beside the viewport on wide screens and move into drawers on small ones. */}
        <aside className="hidden w-56 shrink-0 border-r md:block">
          <ObjectTree />
        </aside>
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <Viewport />
          {statsOpen && <StatsOverlay />}
        </main>
        <aside className="hidden w-60 shrink-0 border-l md:block">
          <PropertiesPanel />
        </aside>
      </div>
      {consoleOpen && <CommandConsole />}
    </div>
  )
}
