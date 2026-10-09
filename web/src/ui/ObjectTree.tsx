import { Lock, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/ui/components/ui/button'
import { useEngineState, useRun } from './services'
import { MODE_LABELS } from './tools'

export function ObjectTree() {
  const { mode, objects } = useEngineState()
  const run = useRun()

  return (
    <section className="flex h-full flex-col">
      <h2 className="border-b px-3 py-2 font-medium">Objects</h2>
      {objects.length === 0 ? (
        <p className="px-3 py-3 text-muted-foreground">
          No objects yet. Open the console and run{' '}
          <code className="rounded bg-muted px-1 py-0.5">object.add</code> to add an empty one.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {objects.map((object) => {
            // Objects from the other mode stay visible but are dimmed and locked.
            const locked = object.mode !== mode
            return (
              <li
                key={object.id}
                className={cn('flex h-7 items-center gap-2 pr-1 pl-3', locked && 'opacity-50')}
              >
                <span className="min-w-0 flex-1 truncate">{object.name}</span>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {MODE_LABELS[object.mode]}
                </span>
                {locked ? (
                  <Lock
                    className="mx-1.5 size-3 shrink-0"
                    aria-label={`Locked: edit in ${MODE_LABELS[object.mode]} mode`}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${object.name}`}
                    onClick={() => void run({ name: 'object.remove', params: { id: object.id } })}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
