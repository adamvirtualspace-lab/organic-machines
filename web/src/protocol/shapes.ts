export type Vec3 = readonly [number, number, number]

export const PRIMITIVE_KINDS = [
  'sphere',
  'box',
  'roundBox',
  'cylinder',
  'capsule',
  'torus',
  'cone',
  'plane',
] as const
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number]

export const BOOLEAN_KINDS = ['union', 'subtract', 'intersect'] as const
export type BooleanKind = (typeof BOOLEAN_KINDS)[number]

export const MODIFIER_KINDS = ['shell', 'round', 'mirror'] as const
export type ModifierKind = (typeof MODIFIER_KINDS)[number]

export const AXES = ['x', 'y', 'z'] as const
export type Axis = (typeof AXES)[number]

/**
 * The editable shape of one Organic object: a tree of primitives, booleans and modifiers.
 * Lengths are millimetres. Primitives are centred on their own origin with Z as their axis.
 * A node's position, rotation and scale place it inside its parent.
 */
interface NodeBase {
  readonly id: string
  readonly name?: string
  /** A hidden node is left out of the shape, along with everything under it. */
  readonly hidden?: boolean
  readonly position: Vec3
  /** Euler angles in degrees, about X then Y then Z. */
  readonly rotation?: Vec3
  /** Uniform scale. */
  readonly scale?: number
}

export type PrimitiveNode = NodeBase &
  (
    | { readonly kind: 'sphere'; readonly radius: number }
    | { readonly kind: 'box'; readonly size: Vec3 }
    | { readonly kind: 'roundBox'; readonly size: Vec3; readonly radius: number }
    | { readonly kind: 'cylinder'; readonly radius: number; readonly height: number }
    /** `height` is the full length, caps included. */
    | { readonly kind: 'capsule'; readonly radius: number; readonly height: number }
    /** `major` is the ring radius, `minor` the tube radius. */
    | { readonly kind: 'torus'; readonly major: number; readonly minor: number }
    /** Base of `radius` at the bottom, apex at the top. */
    | { readonly kind: 'cone'; readonly radius: number; readonly height: number }
    /** Everything below the local XY plane. */
    | { readonly kind: 'plane' }
  )

/** The first child combined with each later one. `blend` above zero smooths the join by that distance. */
export type BooleanNode = NodeBase & {
  readonly kind: BooleanKind
  readonly blend: number
  readonly children: readonly SdfTree[]
}

export type ModifierNode = NodeBase &
  /** Hollows the child, keeping a wall of `thickness` inside its surface. */
  (
    | { readonly kind: 'shell'; readonly thickness: number; readonly child: SdfTree }
    /** Grows the child outward by `radius`, rounding its edges. */
    | { readonly kind: 'round'; readonly radius: number; readonly child: SdfTree }
    | { readonly kind: 'mirror'; readonly axis: Axis; readonly child: SdfTree }
  )

export type SdfTree = PrimitiveNode | BooleanNode | ModifierNode

export function childrenOf(node: SdfTree): readonly SdfTree[] {
  if ('children' in node) return node.children
  if ('child' in node) return [node.child]
  return []
}

export function findNode(tree: SdfTree, id: string): SdfTree | undefined {
  if (tree.id === id) return tree
  for (const child of childrenOf(tree)) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}
