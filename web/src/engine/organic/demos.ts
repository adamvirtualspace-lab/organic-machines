import type { DemoScene } from '../../protocol'
import type { Vec3 } from './math'
import type { PrimitiveNode, SdfTree } from './tree'

export interface DemoObject {
  name: string
  sdf: SdfTree
}

export const STRESS_OBJECTS = 10
export const STRESS_PRIMITIVES_PER_OBJECT = 10

export function demoScene(name: DemoScene): DemoObject[] {
  return name === 'test' ? testScene() : stressScene()
}

/** The plan's O1 scene: a box with a sphere smoothly carved out of it, plus a torus. */
function testScene(): DemoObject[] {
  return [
    {
      name: 'Carved block',
      sdf: {
        id: 'n1',
        kind: 'subtract',
        position: [0, 0, 30],
        blend: 6,
        children: [
          { id: 'n2', kind: 'box', position: [0, 0, 0], size: [80, 80, 60] },
          { id: 'n3', kind: 'sphere', position: [25, -25, 25], radius: 38 },
        ],
      },
    },
    {
      name: 'Ring',
      sdf: { id: 'n1', kind: 'torus', position: [120, 40, 12], major: 45, minor: 12 },
    },
  ]
}

/** A small deterministic random source, so the stress scene is the same on every run and device. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 100 primitives in 10 objects, each a smooth union of nine shapes with a tenth carved out. */
function stressScene(): DemoObject[] {
  const random = mulberry32(20261010)
  const range = (low: number, high: number) => low + random() * (high - low)
  const vec = (spread: number): Vec3 => [
    range(-spread, spread),
    range(-spread, spread),
    range(-spread, spread),
  ]

  const primitive = (id: string): PrimitiveNode => {
    const base = { id, position: vec(28) }
    // Half the shapes are rotated, so the rotate path is exercised without paying for it everywhere.
    const turned = random() < 0.5 ? { ...base, rotation: vec(180) } : base
    const size = range(10, 22)
    switch (Math.floor(random() * 7)) {
      case 0:
        return { ...base, kind: 'sphere', radius: size }
      case 1:
        return { ...turned, kind: 'box', size: [size * 1.6, size * 1.2, size] }
      case 2:
        return {
          ...turned,
          kind: 'roundBox',
          size: [size * 1.5, size * 1.5, size],
          radius: size * 0.3,
        }
      case 3:
        return { ...turned, kind: 'cylinder', radius: size * 0.6, height: size * 2 }
      case 4:
        return { ...turned, kind: 'capsule', radius: size * 0.5, height: size * 2.4 }
      case 5:
        return { ...turned, kind: 'torus', major: size, minor: size * 0.3 }
      default:
        return { ...turned, kind: 'cone', radius: size * 0.8, height: size * 1.8 }
    }
  }

  return Array.from({ length: STRESS_OBJECTS }, (_, index) => {
    let nextId = 1
    const id = () => `n${nextId++}`
    const root = id()
    const blob = id()
    const added = Array.from({ length: STRESS_PRIMITIVES_PER_OBJECT - 1 }, () => primitive(id()))
    return {
      name: `Stress ${index + 1}`,
      sdf: {
        id: root,
        kind: 'subtract',
        // Two rows of five, spaced so neighbours do not overlap.
        position: [((index % 5) - 2) * 120, (Math.floor(index / 5) - 0.5) * 130, 55],
        blend: 6,
        children: [
          { id: blob, kind: 'union', position: [0, 0, 0], blend: 10, children: added },
          { id: id(), kind: 'sphere', position: vec(28), radius: range(14, 22) },
        ],
      },
    }
  })
}
