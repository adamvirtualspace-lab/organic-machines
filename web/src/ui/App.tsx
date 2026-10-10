import { useEffect } from 'react'
import { CommandConsole } from './CommandConsole'
import { ObjectTree } from './ObjectTree'
import { PropertiesPanel } from './PropertiesPanel'
import { useRun, useSelected, useServices } from './services'
import { StatsOverlay } from './StatsOverlay'
import { useUi } from './store'
import { Toolbar } from './Toolbar'
import { TopBar } from './TopBar'
import { Viewport } from './Viewport'

/** Keyboard shortcuts. Every one of them also has a button, so none is the only way. */
function useShortcuts(): void {
  const run = useRun()
  const selected = useSelected()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input, textarea, [contenteditable]')) {
        return
      }
      const command = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (command && key === 'z') {
        void run({ name: event.shiftKey ? 'redo' : 'undo', params: {} })
      } else if (command && key === 'y') {
        void run({ name: 'redo', params: {} })
      } else if (key === 'escape' && selected) {
        void run({ name: 'select.clear', params: {} })
      } else if ((key === 'delete' || key === 'backspace') && selected) {
        const { object, node } = selected
        void run(
          node && node.id !== object.sdf?.id
            ? { name: 'organic.remove', params: { id: object.id, node: node.id } }
            : { name: 'object.remove', params: { id: object.id } },
        )
      } else {
        return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, selected])
}

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

  useShortcuts()

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
