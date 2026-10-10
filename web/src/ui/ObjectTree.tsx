import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { childrenOf, type ObjectInfo, type SdfTree } from '@/protocol'
import { Button } from '@/ui/components/ui/button'
import { FileActions } from './FileActions'
import { useEngineState, useRun, type Run } from './services'
import { MODE_LABELS, nodeLabel } from './tools'

/** How each later shape in a boolean relates to the first, shown before its name. */
const JOIN_MARK = { union: '+', subtract: '−', intersect: '∩' } as const

export function ObjectTree() {
  const { mode, objects, selection } = useEngineState()
  const run = useRun()

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center border-b py-1 pr-1 pl-3">
        <h2 className="flex-1 font-medium">Objects</h2>
        <FileActions />
      </div>
      {objects.length === 0 ? (
        <p className="px-3 py-3 text-muted-foreground">
          No objects yet. In Organic mode, pick a shape from the toolbar to start one.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {objects.map((object) => {
            // Objects from the other mode stay visible but are dimmed and locked.
            const locked = object.mode !== mode
            const isSelected = selection?.object === object.id
            const rootSelected = isSelected && (!object.sdf || selection.node === object.sdf.id)
            return (
              <li key={object.id} className={cn(locked && 'opacity-50')}>
                <Row
                  label={object.name}
                  depth={0}
                  bold
                  selected={rootSelected}
                  disabled={locked}
                  onSelect={() => void run({ name: 'select', params: { id: object.id } })}
                  tag={MODE_LABELS[object.mode]}
                >
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
                </Row>
                {!locked && object.sdf && (
                  <ul>
                    {childrenOf(object.sdf).map((child, index) => (
                      <NodeRows
                        key={child.id}
                        object={object}
                        parent={object.sdf!}
                        node={child}
                        index={index}
                        depth={1}
                        selectedId={isSelected ? selection.node : undefined}
                        run={run}
                      />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function NodeRows(props: {
  object: ObjectInfo
  parent: SdfTree
  node: SdfTree
  index: number
  depth: number
  selectedId: string | undefined
  run: Run
}) {
  const { object, parent, node, index, depth, selectedId, run } = props
  const at = { id: object.id, node: node.id }
  const siblings = childrenOf(parent).length
  const reorderable = 'children' in parent && siblings > 1
  const mark = 'children' in parent && index > 0 ? JOIN_MARK[parent.kind] : undefined
  const label = nodeLabel(node)

  return (
    <li>
      <Row
        label={label}
        mark={mark}
        depth={depth}
        selected={selectedId === node.id}
        faded={node.hidden}
        onSelect={() => void run({ name: 'select', params: at })}
      >
        {selectedId === node.id ? (
          <>
            {reorderable && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${label} earlier`}
                  disabled={index === 0}
                  onClick={() => void run({ name: 'organic.move', params: { ...at, by: -1 } })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${label} later`}
                  disabled={index === siblings - 1}
                  onClick={() => void run({ name: 'organic.move', params: { ...at, by: 1 } })}
                >
                  <ArrowDown />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={node.hidden ? `Show ${label}` : `Hide ${label}`}
              onClick={() =>
                void run({ name: 'organic.hide', params: { ...at, hidden: !node.hidden } })
              }
            >
              {node.hidden ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${label}`}
              onClick={() => void run({ name: 'organic.remove', params: at })}
            >
              <Trash2 />
            </Button>
          </>
        ) : (
          node.hidden && <EyeOff className="mx-1.5 size-3 shrink-0" aria-label="Hidden" />
        )}
      </Row>
      {childrenOf(node).length > 0 && (
        <ul>
          {childrenOf(node).map((child, childIndex) => (
            <NodeRows
              key={child.id}
              {...props}
              parent={node}
              node={child}
              index={childIndex}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** One line of the tree: a button that selects it, followed by whatever actions it carries. */
function Row(props: {
  label: string
  depth: number
  selected: boolean
  onSelect(): void
  mark?: string
  tag?: string
  bold?: boolean
  faded?: boolean
  disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn('flex h-7 items-center pr-1', props.selected && 'bg-accent')}
      style={{ paddingLeft: `${0.75 + props.depth * 0.75}rem` }}
    >
      <button
        type="button"
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline',
          props.bold && 'font-medium',
          props.faded && 'text-muted-foreground',
        )}
        aria-current={props.selected}
        disabled={props.disabled}
        onClick={props.onSelect}
      >
        {props.mark && <span className="w-2 shrink-0 text-muted-foreground">{props.mark}</span>}
        <span className="truncate">{props.label}</span>
      </button>
      {props.tag && (
        <span className="shrink-0 px-1 text-[0.625rem] text-muted-foreground">{props.tag}</span>
      )}
      {props.children}
    </div>
  )
}
