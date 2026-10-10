import { childrenOf, type SdfTree } from '../../protocol'
import { add, mul, multiply, quatFromEuler, rotate, type Quat, type Vec3 } from './math'

/** A coordinate space inside a shape tree, expressed in world terms. */
export interface Frame {
  origin: Vec3
  rotation: Quat
  scale: number
}

export const WORLD: Frame = { origin: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 }

export interface NodePlacement {
  /** The space the node's `position` is measured in, so its axes are the directions it moves along. */
  parent: Frame
  /** Where the node's own origin sits in the world. */
  origin: Vec3
}

/** Finds where a node sits in the world. Mirrors above it are ignored: the original side is reported. */
export function placeNode(
  tree: SdfTree,
  id: string,
  parent: Frame = WORLD,
): NodePlacement | undefined {
  const origin = add(parent.origin, rotate(mul(tree.position, parent.scale), parent.rotation))
  if (tree.id === id) return { parent, origin }
  const own: Frame = {
    origin,
    rotation: tree.rotation
      ? multiply(parent.rotation, quatFromEuler(tree.rotation))
      : parent.rotation,
    scale: parent.scale * (tree.scale ?? 1),
  }
  for (const child of childrenOf(tree)) {
    const found = placeNode(child, id, own)
    if (found) return found
  }
  return undefined
}
