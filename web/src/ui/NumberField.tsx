import { useRef, useState } from 'react'
import { cn } from 'cn'
import { formatCommand, type Command } from '@/protocol'
import { Input } from '@/ui/components/ui/input'
import { useRun } from './services'
import { useUi } from './store'

const show = (value: number) => String(Math.round(value * 100) / 100)

/**
 * A number that can be typed, or changed by dragging its label sideways. A drag previews live
 * and lands as a single undo step; holding Shift makes it ten times finer.
 */
export function NumberField(props: {
  label: string
  value: number
  /** Change per pixel dragged. */
  step?: number
  /** Gives the label the same width as the panel's other row labels. */
  wide?: boolean
  toCommand(value: number): Command
}) {
  const { label, value, step = 0.5, wide, toCommand } = props
  const run = useRun()
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; from: number; last: Command | null } | null>(null)

  function commitDraft(): void {
    if (draft === null) return
    const typed = draft.trim() === '' ? NaN : Number(draft)
    setDraft(null)
    if (Number.isFinite(typed) && typed !== value) void run(toCommand(typed))
  }

  function endScrub(event: React.PointerEvent, commit: boolean): void {
    const state = scrub.current
    if (!state) return
    scrub.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    void run({ name: commit ? 'edit.commit' : 'edit.cancel', params: {} }, { quiet: true })
    // The drag sent its updates quietly; record where it ended as one console line.
    if (commit && state.last) useUi.getState().log('input', formatCommand(state.last))
  }

  return (
    <label className={cn('flex min-w-0 flex-1 items-center', wide ? 'gap-2' : 'gap-1')}>
      <span
        className={cn(
          'shrink-0 cursor-ew-resize touch-none text-muted-foreground select-none',
          wide && 'w-16',
        )}
        title="Drag to change"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub.current = { x: event.clientX, from: value, last: null }
          void run({ name: 'edit.begin', params: {} }, { quiet: true })
        }}
        onPointerMove={(event) => {
          const state = scrub.current
          if (!state) return
          const fine = event.shiftKey ? 0.1 : 1
          const next =
            Math.round((state.from + (event.clientX - state.x) * step * fine) * 100) / 100
          state.last = toCommand(next)
          void run(state.last, { quiet: true })
        }}
        onPointerUp={(event) => endScrub(event, true)}
        onPointerCancel={(event) => endScrub(event, false)}
      >
        {label}
      </span>
      <Input
        className="h-6 min-w-0 px-1.5 text-right tabular-nums select-text"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? show(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') setDraft(null)
        }}
      />
    </label>
  )
}
