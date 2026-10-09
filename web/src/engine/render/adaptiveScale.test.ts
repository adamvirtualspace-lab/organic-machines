import { describe, expect, it } from 'vitest'
import { createAdaptiveScale } from './adaptiveScale'

const options = { start: 0.5, min: 0.25, max: 1, step: 0.125, slowMs: 36, fastMs: 19 }

/** Feeds `count` frames spaced `gap` ms apart and returns the final scale. */
function run(scale: ReturnType<typeof createAdaptiveScale>, gap: number, count: number, from = 0) {
  let now = from
  for (let i = 0; i < count; i++) scale.frame((now += gap))
  return now
}

describe('adaptive SDF scale', () => {
  it('starts at the given scale and holds it for a steady, acceptable frame rate', () => {
    const scale = createAdaptiveScale(options)
    expect(scale.value).toBe(0.5)
    run(scale, 25, 200) // 40 fps: neither slow nor fast.
    expect(scale.value).toBe(0.5)
  })

  it('steps down to the minimum when frames are slow, and no further', () => {
    const scale = createAdaptiveScale(options)
    run(scale, 60, 8)
    expect(scale.value).toBe(0.375)
    run(scale, 60, 200, 1000)
    expect(scale.value).toBe(0.25)
  })

  it('steps up to the maximum when there is headroom, and no further', () => {
    const scale = createAdaptiveScale(options)
    run(scale, 8, 8)
    expect(scale.value).toBe(0.625)
    run(scale, 8, 200, 1000)
    expect(scale.value).toBe(1)
  })

  it('waits a few frames after each change before changing again', () => {
    const scale = createAdaptiveScale(options)
    const seen: number[] = []
    let now = 0
    for (let i = 0; i < 13; i++) seen.push(scale.frame((now += 60)))
    // The first frame has no gap to measure; after that a change needs six frames of evidence.
    expect(seen).toEqual([
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.375, 0.375, 0.375, 0.375, 0.375, 0.375, 0.25,
    ])
  })

  it('ignores the pause between two bursts of movement', () => {
    const scale = createAdaptiveScale(options)
    let now = run(scale, 25, 5)
    // A five-second pause is not a slow frame.
    now += 5000
    scale.frame(now)
    run(scale, 25, 10, now)
    expect(scale.value).toBe(0.5)
  })
})
