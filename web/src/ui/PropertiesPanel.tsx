import { useState } from 'react'
import {
  AXES,
  BOOLEAN_KINDS,
  type Axis,
  type BooleanKind,
  type Command,
  type ObjectInfo,
  type SdfTree,
  type Vec3,
} from '@/protocol'
import { Input } from '@/ui/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { NumberField } from './NumberField'
import { useRun, useSelected } from './services'
import { COMBINE_LABELS, nodeLabel } from './tools'

/** Single numbers a node may carry, with the label and drag speed for each. */
const NUMBERS: readonly { field: string; label: string; step: number }[] = [
  { field: 'radius', label: 'Radius', step: 0.25 },
  { field: 'height', label: 'Height', step: 0.5 },
  { field: 'major', label: 'Ring radius', step: 0.25 },
  { field: 'minor', label: 'Tube radius', step: 0.1 },
  { field: 'thickness', label: 'Wall', step: 0.1 },
  { field: 'blend', label: 'Blend', step: 0.1 },
]

export function PropertiesPanel() {
  const selected = useSelected()

  return (
    <section className="flex h-full flex-col">
      <h2 className="border-b px-3 py-2 font-medium">Properties</h2>
      {selected ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {/* Remounting on a new selection drops any half-typed value from the previous one. */}
          <Fields key={`${selected.object.id}/${selected.node?.id}`} {...selected} />
        </div>
      ) : (
        <p className="px-3 py-3 text-muted-foreground">
          Nothing is selected. Click a shape in the view or a row in the object list.
        </p>
      )}
    </section>
  )
}

function Fields({ object, node }: { object: ObjectInfo; node: SdfTree | undefined }) {
  const run = useRun()
  const isRoot = !node || node.id === object.sdf?.id
  const at = { id: object.id, node: node?.id ?? '' }
  const set =
    (param: string) =>
    (value: number): Command => ({
      name: 'organic.set',
      params: { ...at, param, value },
    })
  const record = node as unknown as Record<string, unknown> | undefined

  return (
    <>
      <Line label="Name">
        <NameField
          value={isRoot ? object.name : (node.name ?? '')}
          placeholder={node ? nodeLabel({ ...node, name: undefined }) : undefined}
          onCommit={(name) =>
            void run(
              isRoot
                ? { name: 'object.rename', params: { id: object.id, name } }
                : { name: 'organic.rename', params: { ...at, name } },
            )
          }
        />
      </Line>

      {node && 'children' in node && (
        <Line label="Joins by">
          <Choice
            label="How these shapes combine"
            value={node.kind}
            options={BOOLEAN_KINDS}
            labels={COMBINE_LABELS}
            onChange={(op: BooleanKind) => void run({ name: 'organic.op', params: { ...at, op } })}
          />
        </Line>
      )}
      {node?.kind === 'mirror' && (
        <Line label="Across">
          <Choice
            label="Mirror axis"
            value={node.axis}
            options={AXES}
            labels={{ x: 'X', y: 'Y', z: 'Z' }}
            onChange={(axis: Axis) => void run({ name: 'organic.axis', params: { ...at, axis } })}
          />
        </Line>
      )}

      {node && (
        <>
          {NUMBERS.filter(({ field }) => typeof record?.[field] === 'number').map((number) => (
            <NumberField
              key={number.field}
              wide
              label={number.label}
              value={record![number.field] as number}
              step={number.step}
              toCommand={set(number.field)}
            />
          ))}
          {'size' in node && <VectorLine label="Size" field="size" value={node.size} set={set} />}
          <VectorLine label="Position" field="position" value={node.position} set={set} />
          <VectorLine
            label="Rotation"
            field="rotation"
            value={node.rotation ?? [0, 0, 0]}
            step={1}
            set={set}
          />
          <NumberField
            wide
            label="Scale"
            value={node.scale ?? 1}
            step={0.01}
            toCommand={set('scale')}
          />
        </>
      )}
    </>
  )
}

function Line(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-muted-foreground">{props.label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{props.children}</div>
    </div>
  )
}

function VectorLine(props: {
  label: string
  field: string
  value: Vec3
  step?: number
  set(param: string): (value: number) => Command
}) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground">{props.label}</span>
      <div className="flex gap-1">
        {AXES.map((axis, index) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            value={props.value[index]!}
            step={props.step}
            toCommand={props.set(`${props.field}.${axis}`)}
          />
        ))}
      </div>
    </div>
  )
}

function Choice<T extends string>(props: {
  label: string
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onChange(value: T): void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={props.label}
      value={props.value}
      onValueChange={(value) => {
        const option = props.options.find((o) => o === value)
        if (option) props.onChange(option)
      }}
    >
      {props.options.map((option) => (
        <ToggleGroupItem key={option} value={option}>
          {props.labels[option]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function NameField(props: { value: string; placeholder?: string; onCommit(name: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      className="h-6 select-text"
      aria-label="Name"
      value={draft ?? props.value}
      placeholder={props.placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== props.value) props.onCommit(draft)
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') setDraft(null)
      }}
    />
  )
}
