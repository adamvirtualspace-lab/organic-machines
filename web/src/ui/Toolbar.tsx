import {
  BOOLEAN_KINDS,
  MODIFIER_KINDS,
  PRIMITIVE_KINDS,
  type BooleanKind,
  type PrimitiveKind,
} from '@/protocol'
import { Button } from '@/ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useEngineState, useRun, useSelected } from './services'
import { useUi } from './store'
import {
  COMBINE_LABELS,
  MACHINES_TOOLS,
  MODE_LABELS,
  MODIFIER_LABELS,
  PRIMITIVE_LABELS,
} from './tools'
import { ViewActions } from './ViewActions'

/** The current mode's tools. */
export function Toolbar() {
  const { mode } = useEngineState()

  return (
    <div className="flex h-9 shrink-0 items-center border-b">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none]"
        role="toolbar"
        aria-label={`${MODE_LABELS[mode]} tools`}
      >
        {mode === 'organic' ? <OrganicTools /> : <MachinesTools />}
      </div>
      {/* On phones the top bar has no room for these, so they sit here instead. */}
      <ViewActions className="flex border-l px-1 sm:hidden" />
    </div>
  )
}

/**
 * Primitives go into the selected object, joined to the selected shape the way the Add / Cut /
 * Keep overlap switch says. With nothing selected, a primitive starts a new object.
 */
function OrganicTools() {
  const run = useRun()
  const selected = useSelected()
  const combine = useUi((s) => s.combine)
  const setCombine = useUi((s) => s.setCombine)
  const target = selected?.object.mode === 'organic' ? selected : null

  const add = (kind: PrimitiveKind) =>
    void run({
      name: 'organic.add',
      params: target
        ? { kind, op: combine, id: target.object.id, node: target.node?.id }
        : { kind },
    })

  return (
    <>
      <span className="hidden max-w-40 shrink-0 truncate text-muted-foreground sm:inline">
        {target ? `Adding to ${target.object.name}` : 'Adding a new object'}
      </span>
      {target && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          title="Deselect, so the next shape starts a new object"
          onClick={() => void run({ name: 'select.clear', params: {} })}
        >
          New object
        </Button>
      )}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        className="shrink-0"
        aria-label="How the next shape joins"
        value={combine}
        disabled={!target}
        onValueChange={(value) => {
          if (isCombine(value)) setCombine(value)
        }}
      >
        {BOOLEAN_KINDS.map((kind) => (
          <ToggleGroupItem key={kind} value={kind}>
            {COMBINE_LABELS[kind]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Divider />
      {PRIMITIVE_KINDS.map((kind) => (
        <Button key={kind} variant="ghost" size="sm" className="shrink-0" onClick={() => add(kind)}>
          {PRIMITIVE_LABELS[kind]}
        </Button>
      ))}
      <Divider />
      {MODIFIER_KINDS.map((kind) => (
        <Button
          key={kind}
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={!target?.node}
          title="Applies to the selected shape"
          onClick={() =>
            target?.node &&
            void run({
              name: 'organic.wrap',
              params: { id: target.object.id, node: target.node.id, kind },
            })
          }
        >
          {MODIFIER_LABELS[kind]}
        </Button>
      ))}
    </>
  )
}

function MachinesTools() {
  return (
    <>
      {MACHINES_TOOLS.map((tool) => (
        <Button
          key={tool.label}
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled
          title={`Arrives in phase ${tool.phase}`}
        >
          {tool.label}
        </Button>
      ))}
      <span className="shrink-0 pl-3 text-muted-foreground">
        Machines tools arrive in later phases
      </span>
    </>
  )
}

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
}

function isCombine(value: string): value is BooleanKind {
  return (BOOLEAN_KINDS as readonly string[]).includes(value)
}
