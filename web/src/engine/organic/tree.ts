import {
  AXES,
  BOOLEAN_KINDS,
  childrenOf,
  findNode,
  type Axis,
  type BooleanKind,
  type ModifierKind,
  type PrimitiveKind,
  type PrimitiveNode,
  type SdfTree,
  type Vec3,
} from '../../protocol'
import { CommandError } from '../errors'

export { childrenOf, findNode }
export type { BooleanNode, ModifierNode, PrimitiveNode, SdfTree } from '../../protocol'

const NUMBER_FIELDS = ['radius', 'height', 'major', 'minor', 'blend', 'thickness', 'scale']
const VECTOR_FIELDS = ['position', 'rotation', 'size']
const OPTIONAL_FIELDS = ['rotation', 'scale']
/** Blend given to a boolean made by adding a shape: Organic joins are smooth unless made sharp. */
export const DEFAULT_BLEND = 6

const isBoolean = (kind: string): kind is BooleanKind =>
  (BOOLEAN_KINDS as readonly string[]).includes(kind)

function requireNode(tree: SdfTree, id: string): SdfTree {
  const node = findNode(tree, id)
  if (!node) throw new CommandError(`There is no node "${id}"`)
  return node
}

function parentOf(tree: SdfTree, id: string): SdfTree | undefined {
  for (const child of childrenOf(tree)) {
    if (child.id === id) return tree
    const found = parentOf(child, id)
    if (found) return found
  }
  return undefined
}

/** Replaces one node, sharing every untouched branch. Returning undefined removes it. */
function mapNode(
  tree: SdfTree,
  id: string,
  change: (node: SdfTree) => SdfTree | undefined,
): SdfTree | undefined {
  if (tree.id === id) return change(tree)
  if ('children' in tree) {
    const children = tree.children.flatMap((child) => mapNode(child, id, change) ?? [])
    if (children.length === 0) return undefined // A boolean with nothing left goes too.
    const same =
      children.length === tree.children.length && children.every((c, i) => c === tree.children[i])
    return same ? tree : { ...tree, children }
  }
  if ('child' in tree) {
    const child = mapNode(tree.child, id, change)
    if (!child) return undefined // So does a modifier with nothing to modify.
    return child === tree.child ? tree : { ...tree, child }
  }
  return tree
}

/** An id no node in the tree uses yet. */
export function nextNodeId(tree: SdfTree | undefined): string {
  let highest = 0
  const visit = (node: SdfTree) => {
    const number = /^n(\d+)$/.exec(node.id)
    if (number) highest = Math.max(highest, Number(number[1]))
    childrenOf(node).forEach(visit)
  }
  if (tree) visit(tree)
  return `n${highest + 1}`
}

export function newPrimitive(kind: PrimitiveKind, id: string, position: Vec3): PrimitiveNode {
  const base = { id, position }
  switch (kind) {
    case 'sphere':
      return { ...base, kind, radius: 20 }
    case 'box':
      return { ...base, kind, size: [40, 40, 40] }
    case 'roundBox':
      return { ...base, kind, size: [40, 40, 40], radius: 6 }
    case 'cylinder':
      return { ...base, kind, radius: 15, height: 40 }
    case 'capsule':
      return { ...base, kind, radius: 12, height: 50 }
    case 'torus':
      return { ...base, kind, major: 25, minor: 8 }
    case 'cone':
      return { ...base, kind, radius: 18, height: 40 }
    case 'plane':
      return { ...base, kind }
  }
}

/**
 * Combines `shape` with the node `targetId`. It joins an existing boolean of the same kind
 * where one is at hand (the target itself, or its parent); otherwise the target is wrapped in a
 * new boolean, which takes the id `groupId`.
 */
export function addShape(
  tree: SdfTree,
  targetId: string,
  op: BooleanKind,
  shape: SdfTree,
  groupId: string,
): SdfTree {
  const target = requireNode(tree, targetId)
  const parent = parentOf(tree, targetId)
  const host = target.kind === op ? target : parent?.kind === op ? parent : undefined
  if (host && 'children' in host) {
    return mapNode(tree, host.id, () => ({ ...host, children: [...host.children, shape] }))!
  }
  return mapNode(tree, targetId, () => ({
    id: groupId,
    kind: op,
    position: [0, 0, 0],
    blend: DEFAULT_BLEND,
    children: [target, shape],
  }))!
}

/** Removes a node. Returns undefined when nothing is left of the tree. */
export function removeNode(tree: SdfTree, id: string): SdfTree | undefined {
  requireNode(tree, id)
  return mapNode(tree, id, () => undefined)
}

/** Moves a node earlier (`by` below zero) or later among its siblings. */
export function moveNode(tree: SdfTree, id: string, by: number): SdfTree {
  requireNode(tree, id)
  const parent = parentOf(tree, id)
  if (!parent || !('children' in parent)) throw new CommandError('This node has no siblings')
  const from = parent.children.findIndex((child) => child.id === id)
  const to = from + Math.sign(by)
  if (to < 0 || to >= parent.children.length) {
    throw new CommandError(`It is already ${by < 0 ? 'first' : 'last'}`)
  }
  const children = [...parent.children]
  ;[children[from], children[to]] = [children[to]!, children[from]!]
  return mapNode(tree, parent.id, () => ({ ...parent, children }))!
}

/** Puts a modifier around a node. The modifier takes the id `modifierId`. */
export function wrapNode(
  tree: SdfTree,
  id: string,
  kind: ModifierKind,
  modifierId: string,
): SdfTree {
  const child = requireNode(tree, id)
  const base = { id: modifierId, position: [0, 0, 0] as Vec3, child }
  const modifier: SdfTree =
    kind === 'shell'
      ? { ...base, kind, thickness: 3 }
      : kind === 'round'
        ? { ...base, kind, radius: 3 }
        : { ...base, kind, axis: 'x' }
  return mapNode(tree, id, () => modifier)!
}

/** Sets an optional field, or removes it entirely when the value is undefined. */
function withOptional(node: SdfTree, field: 'name' | 'hidden', value: string | true | undefined) {
  const copy: Record<string, unknown> = { ...node }
  if (value === undefined) delete copy[field]
  else copy[field] = value
  return copy as unknown as SdfTree
}

export function renameNode(tree: SdfTree, id: string, name: string): SdfTree {
  requireNode(tree, id)
  const trimmed = name.trim()
  return mapNode(tree, id, (node) => withOptional(node, 'name', trimmed || undefined))!
}

export function setNodeHidden(tree: SdfTree, id: string, hidden: boolean): SdfTree {
  requireNode(tree, id)
  return mapNode(tree, id, (node) => withOptional(node, 'hidden', hidden || undefined))!
}

export function setBooleanKind(tree: SdfTree, id: string, op: BooleanKind): SdfTree {
  const node = requireNode(tree, id)
  if (!isBoolean(node.kind)) throw new CommandError(`A ${node.kind} does not combine shapes`)
  return mapNode(tree, id, (found) => ({ ...found, kind: op }) as SdfTree)!
}

export function setMirrorAxis(tree: SdfTree, id: string, axis: Axis): SdfTree {
  const node = requireNode(tree, id)
  if (node.kind !== 'mirror') throw new CommandError(`A ${node.kind} has no mirror axis`)
  return mapNode(tree, id, (found) => ({ ...found, axis }) as SdfTree)!
}

/**
 * Returns a copy of the tree with one number changed. `param` is a field name such as `radius`,
 * or a vector field with an axis such as `position.x`. Untouched branches are shared.
 */
export function setTreeParam(tree: SdfTree, nodeId: string, param: string, value: number): SdfTree {
  requireNode(tree, nodeId)
  if (!Number.isFinite(value)) throw new CommandError('The value must be a number')
  return mapNode(tree, nodeId, (node) => {
    const [field = '', axis, ...extra] = param.split('.')
    const record = node as unknown as Record<string, unknown>
    const present = Object.hasOwn(record, field)
    const allowed = present || OPTIONAL_FIELDS.includes(field)
    const fail = () => new CommandError(`A ${node.kind} has no parameter "${param}"`)
    if (!allowed || extra.length > 0) throw fail()

    if (VECTOR_FIELDS.includes(field)) {
      const index = (AXES as readonly string[]).indexOf(axis ?? '')
      if (index < 0) throw new CommandError(`"${field}" needs an axis: ${field}.x, .y or .z`)
      const next = [...((record[field] as Vec3 | undefined) ?? [0, 0, 0])]
      next[index] = value
      return { ...node, [field]: next }
    }
    if (!NUMBER_FIELDS.includes(field) || axis !== undefined) throw fail()
    if (field === 'scale' && value <= 0) throw new CommandError('Scale must be above zero')
    return { ...node, [field]: value }
  })!
}

/**
 * The tree as it should be drawn: hidden nodes dropped, along with any boolean or modifier left
 * with nothing in it. A subtract or intersect whose first shape is hidden disappears entirely,
 * since the rest only make sense as changes to that shape.
 */
export function visibleTree(tree: SdfTree): SdfTree | undefined {
  if (tree.hidden) return undefined
  if ('children' in tree) {
    const kept = tree.children.map(visibleTree)
    if (tree.kind !== 'union' && !kept[0]) return undefined
    const children = kept.filter((child) => child !== undefined)
    if (children.length === 0) return undefined
    const same =
      children.length === tree.children.length && children.every((c, i) => c === tree.children[i])
    return same ? tree : { ...tree, children }
  }
  if ('child' in tree) {
    const child = visibleTree(tree.child)
    if (!child) return undefined
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
  if (typeof id !== 'string' || seenIds.has(id)) {
    throw bad('a shape node has a missing or repeated id')
  }
  seenIds.add(id)
  if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) {
    throw bad(`shape node "${id}" has an unknown kind`)
  }
  const spec = KINDS[kind as SdfTree['kind']]
  const numbersOk = spec.numbers.every((field) => isNumber(node[field]))
  const vectorsOk = ['position', ...spec.vectors].every((field) => isVec3(node[field]))
  const rotationOk = node.rotation === undefined || isVec3(node.rotation)
  const scaleOk = node.scale === undefined || (isNumber(node.scale) && node.scale > 0)
  const nameOk = node.name === undefined || typeof node.name === 'string'
  const hiddenOk = node.hidden === undefined || typeof node.hidden === 'boolean'
  if (!numbersOk || !vectorsOk || !rotationOk || !scaleOk || !nameOk || !hiddenOk) {
    throw bad(`shape node "${id}" has an invalid parameter`)
  }

  const copy: Record<string, unknown> = { id, kind, position: node.position }
  for (const field of [...spec.numbers, ...spec.vectors]) copy[field] = node[field]
  if (node.name) copy.name = node.name
  if (node.hidden) copy.hidden = true
  if (node.rotation !== undefined) copy.rotation = node.rotation
  if (node.scale !== undefined) copy.scale = node.scale

  if (isBoolean(kind)) {
    if (!Array.isArray(node.children) || node.children.length === 0) {
      throw bad(`shape node "${id}" needs at least one child`)
    }
    copy.children = node.children.map((child) => parseTree(child, seenIds))
  } else if (kind === 'shell' || kind === 'round' || kind === 'mirror') {
    if (kind === 'mirror') {
      if (!(AXES as readonly string[]).includes(node.axis as string)) {
        throw bad(`shape node "${id}" has an invalid axis`)
      }
      copy.axis = node.axis
    }
    copy.child = parseTree(node.child, seenIds)
  }
  return copy as unknown as SdfTree
}
