import type { Mode } from '../../protocol'
import type { SdfTree } from '../../protocol'
import { SCHEMA_VERSION } from './schema'

export interface DocObject {
  readonly id: string
  readonly name: string
  readonly mode: Mode
  /** An Organic object's shape. Absent on Machines objects and on empty Organic ones. */
  readonly sdf?: SdfTree
}

/**
 * Documents are immutable: every change builds a new one that shares the untouched parts.
 * That is what makes snapshot undo a matter of keeping the old reference.
 */
export interface Document {
  readonly schemaVersion: number
  /** Internal units are always millimetres; display units are a UI setting. */
  readonly units: 'mm'
  readonly nextId: number
  readonly objects: readonly DocObject[]
}

export function emptyDocument(): Document {
  return { schemaVersion: SCHEMA_VERSION, units: 'mm', nextId: 1, objects: [] }
}
