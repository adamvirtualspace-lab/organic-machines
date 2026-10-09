export interface AdaptiveScaleOptions {
  start: number
  min: number
  max: number
  step: number
  /** A smoothed frame gap above this lowers the scale. */
  slowMs: number
  /** A smoothed frame gap below this raises it. */
  fastMs: number
}

/** Gaps longer than this mean the frames were not consecutive, so they say nothing about speed. */
const IDLE_GAP_MS = 250
/** Frames to watch after each change before judging again, so one adjustment can take effect. */
const SETTLE_FRAMES = 6

export interface AdaptiveScale {
  readonly value: number
  /** Call once per rendered frame with the current time; returns the scale to render at. */
  frame(now: number): number
}

/**
 * Picks the SDF resolution while the view is moving: it steps down when frames come too slowly
 * and back up when there is headroom, so interaction stays smooth on whatever GPU this is.
 */
export function createAdaptiveScale(options: AdaptiveScaleOptions): AdaptiveScale {
  let value = options.start
  let last: number | null = null
  let smoothed = 0
  let watched = 0

  return {
    get value() {
      return value
    },
    frame(now) {
      const gap = last === null ? Infinity : now - last
      last = now
      if (gap > IDLE_GAP_MS) return value

      smoothed = smoothed ? smoothed * 0.7 + gap * 0.3 : gap
      if (++watched < SETTLE_FRAMES) return value
      if (smoothed > options.slowMs && value > options.min) {
        value = Math.max(options.min, value - options.step)
      } else if (smoothed < options.fastMs && value < options.max) {
        value = Math.min(options.max, value + options.step)
      } else {
        return value
      }
      watched = 0
      smoothed = 0
      return value
    },
  }
}
