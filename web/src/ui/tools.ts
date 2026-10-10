import type { BooleanKind, Mode, ModifierKind, PrimitiveKind, SdfTree } from '@/protocol'

export const MODE_LABELS: Record<Mode, string> = { organic: 'Organic', machines: 'Machines' }

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  sphere: 'Sphere',
  box: 'Box',
  roundBox: 'Round box',
  cylinder: 'Cylinder',
  capsule: 'Capsule',
  torus: 'Torus',
  cone: 'Cone',
  plane: 'Plane',
}

/** Named for what they do to the shape, not for the set operation. */
export const COMBINE_LABELS: Record<BooleanKind, string> = {
  union: 'Add',
  subtract: 'Cut',
  intersect: 'Keep overlap',
}

export const MODIFIER_LABELS: Record<ModifierKind, string> = {
  shell: 'Shell',
  round: 'Round',
  mirror: 'Mirror',
}

const GROUP_LABELS: Record<BooleanKind, string> = {
  union: 'Joined shapes',
  subtract: 'Cut shapes',
  intersect: 'Overlap of shapes',
}

/** What to call a shape node: its own name if it has one, otherwise its kind. */
export function nodeLabel(node: SdfTree): string {
  if (node.name) return node.name
  if ('children' in node) return GROUP_LABELS[node.kind]
  if ('child' in node) return MODIFIER_LABELS[node.kind]
  return PRIMITIVE_LABELS[node.kind]
}

export interface ToolEntry {
  label: string
  /** The plan phase in which the tool starts working. */
  phase: string
}

/** Machines tools do nothing yet; they land in the phases named here. */
export const MACHINES_TOOLS: readonly ToolEntry[] = [
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
]
