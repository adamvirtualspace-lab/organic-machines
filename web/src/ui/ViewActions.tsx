import { Activity, House, SquareTerminal } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/ui/components/ui/button'
import { useRun } from './services'
import { useUi } from './store'

/** Camera reset and the console and performance toggles. Shown in the top bar, or in the toolbar row on phones. */
export function ViewActions({ className }: { className?: string }) {
  const run = useRun()
  const consoleOpen = useUi((s) => s.consoleOpen)
  const statsOpen = useUi((s) => s.statsOpen)
  const toggleConsole = useUi((s) => s.toggleConsole)
  const toggleStats = useUi((s) => s.toggleStats)

  return (
    <div className={cn('shrink-0 items-center gap-1', className)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Reset camera"
        onClick={() => void run({ name: 'view.home', params: {} })}
      >
        <House />
      </Button>
      <Button
        variant={consoleOpen ? 'secondary' : 'ghost'}
        size="icon"
        aria-label="Command console"
        aria-pressed={consoleOpen}
        onClick={toggleConsole}
      >
        <SquareTerminal />
      </Button>
      <Button
        variant={statsOpen ? 'secondary' : 'ghost'}
        size="icon"
        aria-label="Performance overlay"
        aria-pressed={statsOpen}
        onClick={toggleStats}
      >
        <Activity />
      </Button>
    </div>
  )
}
