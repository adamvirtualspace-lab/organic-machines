export const MODES = ['organic', 'machines'] as const
export type Mode = (typeof MODES)[number]

export const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const
export type ViewName = (typeof VIEWS)[number]

export const DEMO_SCENES = ['test', 'stress'] as const
export type DemoScene = (typeof DEMO_SCENES)[number]

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
  /** Resolution of the SDF pass relative to the screen: below 1 while the view is moving. */
  readonly sdfScale: number | null
  /** How many times the SDF shader has been rebuilt. Editing a value must not raise it. */
  readonly shaderBuilds: number | null
  /** Time from the last rebuild to its first finished frame. */
  readonly shaderBuildMs: number | null
}

export interface LogMessage {
  readonly kind: 'info' | 'error'
  readonly text: string
}
