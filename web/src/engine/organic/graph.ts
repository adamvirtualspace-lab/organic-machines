import { CommandError } from '../errors'
import {
  add,
  conjugate,
  enclose,
  length,
  mul,
  quatFromEuler,
  rotate,
  type Quat,
  type Sphere,
  type Vec3,
} from './math'
import type { SdfTree } from './tree'

export const GRAPH_VERSION = 1

/**
 * One step of the low-level SDF program. Nodes run in order and refer to earlier ones by index.
 * Node 0 is always the query point. `p` is an offset into the graph's parameter list, so the
 * node list holds only structure: editing a value never changes it.
 */
export type GraphNode =
  | { op: 'point' }
  // Point in, point out.
  | { op: 'translate' | 'rotate' | 'scale'; in: number; p: number }
  | { op: 'mirror'; in: number; axis: 0 | 1 | 2 }
  // Point in, distance out.
  | {
      op: 'sphere' | 'box' | 'roundBox' | 'cylinder' | 'capsule' | 'torus' | 'cone'
      in: number
      p: number
    }
  | { op: 'plane'; in: number }
  // Reserved for the bridge (plan B1): a distance field sampled from a 3D texture.
  | { op: 'volume'; in: number; p: number }
  // Distances in, distance out.
  | { op: 'union' | 'subtract' | 'intersect'; a: number; b: number }
  | { op: 'smoothUnion' | 'smoothSubtract' | 'smoothIntersect'; a: number; b: number; p: number }
  | { op: 'shell' | 'round' | 'scaleDistance'; in: number; p: number }

/** One object's part of the program: nodes `first` to `node`, and where its bounding sphere is stored. */
export interface GraphRoot {
  first: number
  node: number
  /** Offset of four parameters: centre x, y, z and radius. */
  bound: number
}

/** The whole Organic scene as plain data, read by both the shader generator and the CPU evaluator. */
export interface SdfGraph {
  version: typeof GRAPH_VERSION
  nodes: GraphNode[]
  roots: GraphRoot[]
  params: number[]
  /** Offset of the sphere enclosing every root, laid out like a root's bound. */
  sceneBound: number
  /** Which graph node holds each primitive's finished distance, for picking. Not read by shaders. */
  leaves: { node: number; id: string }[]
}

/** Bounds are capped so shader arithmetic stays well inside 32-bit float range. */
export const MAX_BOUND = 100_000

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const
const SMOOTH = {
  union: 'smoothUnion',
  subtract: 'smoothSubtract',
  intersect: 'smoothIntersect',
} as const

/** Compiles object trees into one program. Each tree becomes a root that can be culled on its own. */
export function compileScene(trees: readonly SdfTree[]): SdfGraph {
  const nodes: GraphNode[] = [{ op: 'point' }]
  const params: number[] = []
  const roots: GraphRoot[] = []
  const leaves: SdfGraph['leaves'] = []

  /** Multi-value parameters never straddle a group of four, so the shader reads each from one vec4. */
  const alloc = (values: readonly number[]): number => {
    if (values.length > 1 && (params.length % 4) + values.length > 4) {
      while (params.length % 4 !== 0) params.push(0)
    }
    const offset = params.length
    params.push(...values)
    return offset
  }
  const emit = (node: GraphNode): number => nodes.push(node) - 1
  const boundParams = ({ center, radius }: Sphere): number[] =>
    Number.isFinite(radius) && radius < MAX_BOUND ? [...center, radius] : [0, 0, 0, MAX_BOUND]

  /** Emits `tree` reading from point node `input`; returns its distance node and bound in that space. */
  function build(tree: SdfTree, input: number): { node: number; bound: Sphere } {
    let point = emit({ op: 'translate', in: input, p: alloc(tree.position) })
    let turn: Quat | undefined
    if (tree.rotation) {
      turn = quatFromEuler(tree.rotation)
      point = emit({ op: 'rotate', in: point, p: alloc(conjugate(turn)) })
    }
    let scaleParam: number | undefined
    if (tree.scale !== undefined) {
      scaleParam = alloc([tree.scale])
      point = emit({ op: 'scale', in: point, p: scaleParam })
    }

    const { node: shaped, bound } = shape(tree, point)
    const node =
      scaleParam === undefined ? shaped : emit({ op: 'scaleDistance', in: shaped, p: scaleParam })

    // Move the bound from this node's local space out to its parent's.
    const scale = tree.scale ?? 1
    const scaled = mul(bound.center, scale)
    const center = add(turn ? rotate(scaled, turn) : scaled, tree.position)
    if (!('children' in tree) && !('child' in tree)) leaves.push({ node, id: tree.id })
    return { node, bound: { center, radius: bound.radius * scale } }
  }

  function shape(tree: SdfTree, point: number): { node: number; bound: Sphere } {
    const at = (radius: number): Sphere => ({ center: [0, 0, 0], radius })
    switch (tree.kind) {
      case 'sphere':
        return {
          node: emit({ op: 'sphere', in: point, p: alloc([tree.radius]) }),
          bound: at(tree.radius),
        }
      case 'box': {
        const half = mul(tree.size, 0.5)
        return { node: emit({ op: 'box', in: point, p: alloc(half) }), bound: at(length(half)) }
      }
      case 'roundBox': {
        const half = mul(tree.size, 0.5)
        const radius = Math.max(0, Math.min(tree.radius, ...half))
        const inner: Vec3 = [half[0] - radius, half[1] - radius, half[2] - radius]
        const p = alloc([...inner, radius])
        return { node: emit({ op: 'roundBox', in: point, p }), bound: at(length(half)) }
      }
      case 'cylinder': {
        const half = tree.height / 2
        const p = alloc([tree.radius, half])
        return {
          node: emit({ op: 'cylinder', in: point, p }),
          bound: at(Math.hypot(tree.radius, half)),
        }
      }
      case 'capsule': {
        const half = Math.max(tree.height / 2 - tree.radius, 0)
        const p = alloc([tree.radius, half])
        return { node: emit({ op: 'capsule', in: point, p }), bound: at(half + tree.radius) }
      }
      case 'torus': {
        const p = alloc([tree.major, tree.minor])
        return { node: emit({ op: 'torus', in: point, p }), bound: at(tree.major + tree.minor) }
      }
      case 'cone': {
        const half = tree.height / 2
        const p = alloc([tree.radius, half])
        return {
          node: emit({ op: 'cone', in: point, p }),
          bound: at(Math.hypot(tree.radius, half)),
        }
      }
      case 'plane':
        return { node: emit({ op: 'plane', in: point }), bound: at(Infinity) }
      case 'union':
      case 'subtract':
      case 'intersect': {
        const [first, ...rest] = tree.children.map((child) => build(child, point))
        if (!first) throw new CommandError(`"${tree.id}" has no shapes to combine`)
        const smooth = tree.blend > 0
        const blend = smooth ? alloc([tree.blend]) : 0
        let { node, bound } = first
        for (const next of rest) {
          node = smooth
            ? emit({ op: SMOOTH[tree.kind], a: node, b: next.node, p: blend })
            : emit({ op: tree.kind, a: node, b: next.node })
          if (tree.kind === 'union') bound = enclose(bound, next.bound)
          else if (tree.kind === 'intersect' && next.bound.radius < bound.radius) bound = next.bound
        }
        // A smooth union reads up to blend/4 lower than a true distance, so the bound grows to match.
        const margin = smooth && tree.kind === 'union' ? tree.blend / 4 : 0
        return { node, bound: { ...bound, radius: bound.radius + margin } }
      }
      case 'shell': {
        const child = build(tree.child, point)
        const p = alloc([tree.thickness / 2])
        return { node: emit({ op: 'shell', in: child.node, p }), bound: child.bound }
      }
      case 'round': {
        const child = build(tree.child, point)
        const node = emit({ op: 'round', in: child.node, p: alloc([tree.radius]) })
        return {
          node,
          bound: { ...child.bound, radius: child.bound.radius + Math.max(tree.radius, 0) },
        }
      }
      case 'mirror': {
        const axis = AXIS_INDEX[tree.axis]
        const child = build(tree.child, emit({ op: 'mirror', in: point, axis }))
        // The child and its reflection both fit in a sphere centred on the mirror plane.
        const center = [...child.bound.center] as [number, number, number]
        const lift = Math.abs(center[axis])
        center[axis] = 0
        return { node: child.node, bound: { center, radius: child.bound.radius + lift } }
      }
    }
  }

  let scene: Sphere | undefined
  for (const tree of trees) {
    const first = nodes.length
    const { node, bound } = build(tree, 0)
    roots.push({ first, node, bound: alloc(boundParams(bound)) })
    scene = scene ? enclose(scene, bound) : bound
  }
  const sceneBound = alloc(boundParams(scene ?? { center: [0, 0, 0], radius: 0 }))
  return { version: GRAPH_VERSION, nodes, roots, params, sceneBound, leaves }
}

/** Two graphs with the same key differ only in parameter values, so they can share one shader. */
export function structureKey(graph: SdfGraph): string {
  return JSON.stringify([graph.nodes, graph.roots, graph.sceneBound, graph.params.length])
}
