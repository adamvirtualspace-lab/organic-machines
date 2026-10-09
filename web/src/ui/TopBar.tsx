import { PanelLeft, Redo2, SlidersHorizontal, Undo2 } from 'lucide-react'
import { MODES, type Mode } from '@/protocol'
import { Button } from '@/ui/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/ui/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { ObjectTree } from './ObjectTree'
import { PropertiesPanel } from './PropertiesPanel'
import { useEngineState, useRun } from './services'
import { MODE_LABELS } from './tools'
import { ViewActions } from './ViewActions'

export function TopBar() {
  const { mode, canUndo, canRedo } = useEngineState()
  const run = useRun()

  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      <PanelDrawer side="left" title="Objects" icon={<PanelLeft />}>
        <ObjectTree />
      </PanelDrawer>
      <span className="hidden px-1 font-heading text-sm font-medium sm:inline">
        Organic Machines
      </span>

      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        className="mx-auto"
        aria-label="Editing mode"
        value={mode}
        // Radix reports '' when the active item is pressed again; one mode is always active.
        onValueChange={(value) => {
          if (isMode(value)) void run({ name: 'mode.set', params: { mode: value } })
        }}
      >
        {MODES.map((m) => (
          <ToggleGroupItem key={m} value={m} className="px-3">
            {MODE_LABELS[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => void run({ name: 'undo', params: {} })}
      >
        <Undo2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => void run({ name: 'redo', params: {} })}
      >
        <Redo2 />
      </Button>
      <ViewActions className="hidden sm:flex" />
      <PanelDrawer side="right" title="Properties" icon={<SlidersHorizontal />}>
        <PropertiesPanel />
      </PanelDrawer>
    </header>
  )
}

/** On small screens a side panel opens as a drawer from this button. Hidden on wide screens. */
function PanelDrawer(props: {
  side: 'left' | 'right'
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={props.title}>
          {props.icon}
        </Button>
      </SheetTrigger>
      <SheetContent side={props.side} className="w-72 gap-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.title} panel</SheetDescription>
        </SheetHeader>
        {props.children}
      </SheetContent>
    </Sheet>
  )
}

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value)
}
