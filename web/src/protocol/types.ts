export const MODES = ['organic', 'machines'] as const
export type Mode = (typeof MODES)[number]

export const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const
export type ViewName = (typeof VIEWS)[number]

export interface ObjectInfo {
  readonly id: string
  readonly name: string
  readonly mode: Mode
}

/** Everything the UI needs to draw itself. The engine sends a fresh snapshot on every change. */
export interface EngineState {
  readonly mode: Mode
  readonly objects: readonly ObjectInfo[]
  readonly canUndo: boolean
  readonly canRedo: boolean
}

/** Null means the number is not available in this environment. */
export interface EngineStats {
  /** CPU time spent building and submitting the last frame. */
  readonly frameMs: number | null
  readonly jsHeapBytes: number | null
  readonly wasmHeapBytes: number
  readonly gpuBytesEstimate: number | null
}
