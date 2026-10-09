import { Button } from '@/ui/components/ui/button'
import { useEngineState } from './services'
import { MODE_LABELS, TOOLS } from './tools'
import { ViewActions } from './ViewActions'

/** The current mode's tools. They are placeholders until their phases land. */
export function Toolbar() {
  const { mode } = useEngineState()

  return (
    <div className="flex h-9 shrink-0 items-center border-b">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none]"
        role="toolbar"
        aria-label={`${MODE_LABELS[mode]} tools`}
      >
        {TOOLS[mode].map((tool) => (
          <Button
            key={tool.label}
            variant="ghost"
            size="sm"
            disabled
            title={`Arrives in phase ${tool.phase}`}
          >
            {tool.label}
          </Button>
        ))}
      </div>
      <span className="hidden shrink-0 px-3 text-muted-foreground lg:inline">
        {MODE_LABELS[mode]} tools arrive in later phases
      </span>
      {/* On phones the top bar has no room for these, so they sit here instead. */}
      <ViewActions className="flex border-l px-1 sm:hidden" />
    </div>
  )
}
