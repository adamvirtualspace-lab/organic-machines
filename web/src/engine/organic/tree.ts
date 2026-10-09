import { CommandError } from '../errors'
import type { Vec3 } from './math'

/**
 * The editable shape of one Organic object: a tree of primitives, booleans and modifiers.
 * Lengths are millimetres. Primitives are centred on their own origin with Z as their axis.
 */
interface NodeBase {
  readonly id: string
  readonly position: Vec3
  /** Euler angles in degrees, about X then Y then Z. Adding or removing it recompiles the shader. */
  readonly rotation?: Vec3
  /** Uniform scale. Adding or removing it recompiles the shader. */
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
  readonly kind: 'union' | 'subtract' | 'intersect'
  readonly blend: number
  readonly children: readonly SdfTree[]
}

export type ModifierNode = NodeBase &
  /** Hollows the child, keeping a wall of `thickness` inside its surface. */
  (
    | { readonly kind: 'shell'; readonly thickness: number; readonly child: SdfTree }
    /** Grows the child outward by `radius`, rounding its edges. */
    | { readonly kind: 'round'; readonly radius: number; readonly child: SdfTree }
    | { readonly kind: 'mirror'; readonly axis: 'x' | 'y' | 'z'; readonly child: SdfTree }
  )

export type SdfTree = PrimitiveNode | BooleanNode | ModifierNode

const NUMBER_FIELDS = ['radius', 'height', 'major', 'minor', 'blend', 'thickness', 'scale']
const VECTOR_FIELDS = ['position', 'rotation', 'size']
const OPTIONAL_FIELDS = ['rotation', 'scale']
const AXES = ['x', 'y', 'z']

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

/**
 * Returns a copy of the tree with one number changed. `param` is a field name such as `radius`,
 * or a vector field with an axis such as `position.x`. Untouched branches are shared.
 */
export function setTreeParam(tree: SdfTree, nodeId: string, param: string, value: number): SdfTree {
  if (!findNode(tree, nodeId)) throw new CommandError(`There is no node "${nodeId}"`)
  if (!Number.isFinite(value)) throw new CommandError('The value must be a number')
  return mapNode(tree, nodeId, (node) => {
    const [field = '', axis, ...extra] = param.split('.')
    const record = node as unknown as Record<string, unknown>
    const present = Object.hasOwn(record, field)
    const allowed = present || OPTIONAL_FIELDS.includes(field)
    const fail = () => new CommandError(`A ${node.kind} has no parameter "${param}"`)
    if (!allowed || extra.length > 0) throw fail()

    if (VECTOR_FIELDS.includes(field)) {
      const index = AXES.indexOf(axis ?? '')
      if (index < 0) throw new CommandError(`"${field}" needs an axis: ${field}.x, .y or .z`)
      const next = [...((record[field] as Vec3 | undefined) ?? [0, 0, 0])]
      next[index] = value
      return { ...node, [field]: next }
    }
    if (!NUMBER_FIELDS.includes(field) || axis !== undefined) throw fail()
    if (field === 'scale' && value <= 0) throw new CommandError('Scale must be above zero')
    return { ...node, [field]: value }
  })
}

function mapNode(tree: SdfTree, id: string, change: (node: SdfTree) => SdfTree): SdfTree {
  if (tree.id === id) return change(tree)
  if ('children' in tree) {
    const children = tree.children.map((child) => mapNode(child, id, change))
    return children.some((child, i) => child !== tree.children[i]) ? { ...tree, children } : tree
  }
  if ('child' in tree) {
    const child = mapNode(tree.child, id, change)
    return child === tree.child ? tree : { ...tree, child }
  }
  return tree
}

const KINDS: Record<SdfTree['kind'], { numbers: string[]; vectors: string[] }> = {
  sphere: { numbers: ['radius'], vectors: [] },
  box: { numbers: [], vectors: ['size'] },
  roundBox: { numbers: ['radius'], vectors: ['size'] },
  cylinder: { numbers: ['radius', 'height'], vectors: [] },
  capsule: { numbers: ['radius', 'height'], vectors: [] },
  torus: { numbers: ['major', 'minor'], vectors: [] },
  cone: { numbers: ['radius', 'height'], vectors: [] },
  plane: { numbers: [], vectors: [] },
  union: { numbers: ['blend'], vectors: [] },
  subtract: { numbers: ['blend'], vectors: [] },
  intersect: { numbers: ['blend'], vectors: [] },
  shell: { numbers: ['thickness'], vectors: [] },
  round: { numbers: ['radius'], vectors: [] },
  mirror: { numbers: [], vectors: [] },
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(isNumber)

/** Checks data read from a file and returns it as a tree, or throws a plain Error naming the problem. */
export function parseTree(raw: unknown, seenIds = new Set<string>()): SdfTree {
  const bad = (what: string) => new Error(what)
  if (typeof raw !== 'object' || raw === null) throw bad('a shape node is not an object')
  const node = raw as Record<string, unknown>
  const { id, kind } = node
  if (typeof id !== 'string' || seenIds.has(id))
    throw bad('a shape node has a missing or repeated id')
  seenIds.add(id)
  if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) {
    throw bad(`shape node "${id}" has an unknown kind`)
  }
  const spec = KINDS[kind as SdfTree['kind']]
  const numbersOk = spec.numbers.every((field) => isNumber(node[field]))
  const vectorsOk = ['position', ...spec.vectors].every((field) => isVec3(node[field]))
  const rotationOk = node.rotation === undefined || isVec3(node.rotation)
  const scaleOk = node.scale === undefined || (isNumber(node.scale) && node.scale > 0)
  if (!numbersOk || !vectorsOk || !rotationOk || !scaleOk) {
    throw bad(`shape node "${id}" has an invalid parameter`)
  }

  const copy: Record<string, unknown> = { id, kind, position: node.position }
  for (const field of [...spec.numbers, ...spec.vectors]) copy[field] = node[field]
  if (node.rotation !== undefined) copy.rotation = node.rotation
  if (node.scale !== undefined) copy.scale = node.scale

  if (kind === 'union' || kind === 'subtract' || kind === 'intersect') {
    if (!Array.isArray(node.children) || node.children.length === 0) {
      throw bad(`shape node "${id}" needs at least one child`)
    }
    copy.children = node.children.map((child) => parseTree(child, seenIds))
  } else if (kind === 'shell' || kind === 'round' || kind === 'mirror') {
    if (kind === 'mirror') {
      if (!AXES.includes(node.axis as string)) throw bad(`shape node "${id}" has an invalid axis`)
      copy.axis = node.axis
    }
    copy.child = parseTree(node.child, seenIds)
  }
  return copy as unknown as SdfTree
}
