import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { COMMAND_SPECS, parseCommand, type CommandSpec } from '@/protocol'
import { Input } from '@/ui/components/ui/input'
import { useRun } from './services'
import { useUi, type LogKind } from './store'

const LINE_STYLE: Record<LogKind, string> = {
  input: 'text-foreground',
  info: 'text-muted-foreground',
  error: 'text-destructive',
}

/** Text access to the same commands the buttons send. `help` lists them. */
export function CommandConsole() {
  const lines = useUi((s) => s.logLines)
  const log = useUi((s) => s.log)
  const run = useRun()
  const [text, setText] = useState('')
  const [recall, setRecall] = useState<number | null>(null)
  const entered = useRef<string[]>([])
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  function submit(): void {
    const input = text.trim()
    if (!input) return
    entered.current.push(input)
    setText('')
    setRecall(null)

    if (input === 'help') {
      log('input', input)
      for (const [name, spec] of Object.entries<CommandSpec>(COMMAND_SPECS)) {
        log('info', `${usage(name, spec)}  —  ${spec.summary}`)
      }
      return
    }
    const parsed = parseCommand(input)
    if (parsed.ok) {
      void run(parsed.command)
    } else {
      log('input', input)
      log('error', parsed.error)
    }
  }

  /** Arrow keys step through earlier entries, newest first. */
  function step(offset: number): void {
    const history = entered.current
    const index = (recall ?? history.length) + offset
    if (index < 0 || index > history.length) return
    setRecall(index === history.length ? null : index)
    setText(history[index] ?? '')
  }

  return (
    <section className="flex h-44 shrink-0 flex-col border-t" aria-label="Command console">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono select-text">
        {lines.length === 0 && (
          <p className="text-muted-foreground">
            Type a command, for example <span className="text-foreground">mode.set machines</span>,
            or <span className="text-foreground">help</span>.
          </p>
        )}
        {lines.map((line) => (
          <div key={line.id} className={cn('whitespace-pre-wrap', LINE_STYLE[line.kind])}>
            {line.kind === 'input' ? `> ${line.text}` : line.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="border-t p-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') step(-1)
            else if (event.key === 'ArrowDown') step(1)
            else return
            event.preventDefault()
          }}
          placeholder="Command"
          aria-label="Command"
          className="font-mono"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      </form>
    </section>
  )
}

function usage(name: string, spec: CommandSpec): string {
  const params = Object.entries(spec.params).map(([key, param]) => {
    const value = param.type === 'enum' ? param.values.join('|') : '…'
    return param.optional ? `[${key}=${value}]` : `${key}=${value}`
  })
  return [name, ...params].join(' ')
}
