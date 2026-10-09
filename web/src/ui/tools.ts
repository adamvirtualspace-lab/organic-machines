import type { Mode } from '@/protocol'

export interface ToolEntry {
  label: string
  /** The plan phase in which the tool starts working. */
  phase: string
}

export const MODE_LABELS: Record<Mode, string> = { organic: 'Organic', machines: 'Machines' }

/** The toolbar for each mode. Nothing here does anything yet; the tools land in later phases. */
export const TOOLS: Record<Mode, readonly ToolEntry[]> = {
  organic: [
    { label: 'Sphere', phase: 'O2' },
    { label: 'Box', phase: 'O2' },
    { label: 'Cylinder', phase: 'O2' },
    { label: 'Torus', phase: 'O2' },
    { label: 'Union', phase: 'O2' },
    { label: 'Subtract', phase: 'O2' },
    { label: 'Intersect', phase: 'O2' },
  ],
  machines: [
    { label: 'Line', phase: 'M2' },
    { label: 'Rectangle', phase: 'M2' },
    { label: 'Circle', phase: 'M2' },
    { label: 'Arc', phase: 'M2' },
    { label: 'Extrude', phase: 'M3a' },
    { label: 'Revolve', phase: 'M3a' },
    { label: 'Boolean', phase: 'M3a' },
    { label: 'Fillet', phase: 'M3b' },
    { label: 'Chamfer', phase: 'M3b' },
    { label: 'Shell', phase: 'M3b' },
  ],
}
