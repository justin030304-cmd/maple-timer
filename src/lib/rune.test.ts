import { describe, expect, it } from 'vitest'
import type { PixelFrame } from './analysis'
import { advanceRuneState, createRuneState, DEFAULT_RUNE_OPTIONS, detectRune } from './rune'

// Synthetic fixtures test the rule, not real-game detection accuracy. No user
// screenshot pixels were available locally to train or validate this detector.
type RGB = [number, number, number]
const pink: RGB = [214, 74, 219]
const cyan: RGB = [42, 221, 231]
const red: RGB = [244, 35, 40]
function frame(width = 120, height = 80): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) data.set([31, 29, 37, 255], index)
  return { data, width, height }
}
function pixel(target: PixelFrame, x: number, y: number, colour: RGB) {
  if (x >= 0 && y >= 0 && x < target.width && y < target.height) target.data.set([...colour, 255], (y * target.width + x) * 4)
}
function diamond(target: PixelFrame, cx: number, cy: number, radius = 6, mode: 'pink-cyan' | 'red' = 'pink-cyan', whiteOutline = false) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const distance = Math.abs(x) + Math.abs(y)
      if (distance > radius) continue
      const colour = mode === 'red' ? red : distance >= radius - 1 ? pink : cyan
      pixel(target, cx + x, cy + y, whiteOutline && distance === radius - 2 ? [245, 245, 251] : colour)
    }
  }
}
const options = { ...DEFAULT_RUNE_OPTIONS }

describe('experimental minimap diamond recognition', () => {
  it('separates a white-outlined violet marker from nearby purple map scaffolding', () => {
    const sample = frame(140, 100)
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
      const distance = Math.abs(x) + Math.abs(y)
      if (distance <= 8) pixel(sample, 55 + x, 40 + y, distance === 8 ? [225, 225, 232] : [174, 108, 196])
    }
    // Dark pixels separate the map line from the marker. Unconditional dilation
    // wrongly joins them into an oversized component and discards the rune.
    for (let y = 6; y <= 88; y++) pixel(sample, 65, y, [160, 75, 185])
    const result = detectRune(sample, options)
    expect(result.candidate).not.toBeNull()
    expect(result.candidate!.width).toBeLessThan(22)
    expect(result.candidate!.height).toBeLessThan(22)
  })

  it('finds a cyan + pink diamond at source-space pixel coordinates', () => {
    const sample = frame()
    diamond(sample, 46, 34)
    const result = detectRune(sample, options)
    expect(result.candidate).toMatchObject({ x: 40, y: 28, width: 13, height: 13 })
    expect(result.candidate!.score).toBeGreaterThanOrEqual(.7)
    expect(result.candidates).toBe(1)
  })
  it.each([3, 4, 8, 12])('handles a translated %i-pixel radius without assuming a fixed minimap location', radius => {
    const sample = frame(180, 100)
    diamond(sample, 120, 55, radius)
    expect(detectRune(sample, options).candidate).toMatchObject({ x: 120 - radius, y: 55 - radius, width: radius * 2 + 1 })
  })
  it('joins coloured parts separated by a white outline', () => {
    const sample = frame()
    diamond(sample, 54, 32, 7, 'pink-cyan', true)
    expect(detectRune(sample, options).candidate).not.toBeNull()
  })
  it('does not confuse a red annotation rectangle around a valid diamond with the icon itself', () => {
    const sample = frame()
    diamond(sample, 50, 35)
    for (let y = 21; y <= 49; y++) for (let x = 36; x <= 64; x++) {
      if (x === 36 || x === 64 || y === 21 || y === 49) pixel(sample, x, y, red)
    }
    expect(detectRune(sample, options).candidate).toMatchObject({ x: 44, y: 29, width: 13, height: 13 })
  })
  it('rejects an empty frame and sparse coloured noise', () => {
    const sample = frame()
    expect(detectRune(sample, options).candidate).toBeNull()
    for (let index = 0; index < 100; index++) pixel(sample, (index * 37) % sample.width, (index * 23) % sample.height, index % 2 ? pink : cyan)
    expect(detectRune(sample, options).candidate).toBeNull()
  })
  it('rejects plain cyan, blue, and red solid squares', () => {
    for (const colour of [cyan, [45, 85, 243] as RGB, red]) {
      const sample = frame()
      for (let y = 25; y < 38; y++) for (let x = 34; x < 47; x++) pixel(sample, x, y, colour)
      expect(detectRune(sample, options).candidate).toBeNull()
    }
  })
  it('rejects a filled square even with both matching colours', () => {
    const sample = frame()
    for (let y = 25; y < 38; y++) for (let x = 34; x < 47; x++) pixel(sample, x, y, x < 40 ? pink : cyan)
    expect(detectRune(sample, options).candidate).toBeNull()
  })
  it('rejects circular icons and rings with the target palette', () => {
    for (const hollow of [false, true]) {
      const sample = frame()
      for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
        const distance = Math.hypot(x, y)
        if (distance <= 8 && (!hollow || distance >= 6)) pixel(sample, 50 + x, 35 + y, x < 0 ? pink : cyan)
      }
      expect(detectRune(sample, options).candidate).toBeNull()
    }
  })
  it('rejects rectangle frames, long lines and partly clipped markers', () => {
    const rectangle = frame()
    for (let y = 20; y <= 40; y++) for (let x = 30; x <= 50; x++) {
      if (x === 30 || x === 50 || y === 20 || y === 40) pixel(rectangle, x, y, x < 40 ? pink : cyan)
    }
    expect(detectRune(rectangle, options).candidate).toBeNull()
    const line = frame()
    for (let x = 15; x < 90; x++) pixel(line, x, 35, x < 45 ? pink : cyan)
    expect(detectRune(line, options).candidate).toBeNull()
    const clipped = frame()
    diamond(clipped, 1, 30, 8)
    expect(detectRune(clipped, options).candidate).toBeNull()
  })
  it('requires both expected colours, rather than colour alone', () => {
    const sample = frame()
    diamond(sample, 46, 34)
    for (let index = 0; index < sample.data.length; index += 4) {
      if (sample.data[index] === cyan[0]) sample.data.set([...pink, 255], index)
    }
    expect(detectRune(sample, options).candidate).toBeNull()
  })
  it.each([4, 6, 9])('accepts a white-outlined violet rune without cyan at radius %i', radius => {
    const sample = frame()
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const distance = Math.abs(x) + Math.abs(y)
      if (distance <= radius) pixel(sample, 55 + x, 40 + y, distance === radius ? [240, 240, 248] : [174, 83, 227])
    }
    expect(detectRune(sample, options).candidate).not.toBeNull()
  })
  it('handles a two-pixel white rim around the violet fill', () => {
    const sample = frame()
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
      const distance = Math.abs(x) + Math.abs(y)
      if (distance <= 8) pixel(sample, 55 + x, 40 + y, distance >= 7 ? [245, 245, 251] : [174, 83, 227])
    }
    expect(detectRune(sample, options).candidate).not.toBeNull()
  })
  it.each(['square', 'circle', 'ring'])('rejects white-outlined violet %s map objects', shape => {
    const sample = frame()
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
      const distance = shape === 'square' ? Math.max(Math.abs(x), Math.abs(y)) : Math.hypot(x, y)
      if (distance > 8 || (shape === 'ring' && distance < 6)) continue
      pixel(sample, 55 + x, 40 + y, distance >= 7 ? [240, 240, 248] : [174, 83, 227])
    }
    expect(detectRune(sample, options).candidate).toBeNull()
  })
  it('respects size and score requirements', () => {
    const sample = frame()
    diamond(sample, 46, 34)
    expect(detectRune(sample, { ...options, maxSize: 10 }).candidate).toBeNull()
    expect(detectRune(sample, { ...options, minSize: 16 }).candidate).toBeNull()
    expect(detectRune(sample, { ...options, minScore: 1 }).candidate).toBeNull()
  })
  it('optionally handles a red diamond while still rejecting a red square frame', () => {
    const sample = frame()
    diamond(sample, 46, 34, 7, 'red')
    expect(detectRune(sample, { ...options, color: 'red' }).candidate).not.toBeNull()
    const square = frame()
    for (let y = 20; y <= 34; y++) for (let x = 30; x <= 44; x++) {
      if (x === 30 || x === 44 || y === 20 || y === 34) pixel(square, x, y, red)
    }
    expect(detectRune(square, { ...options, color: 'red' }).candidate).toBeNull()
  })
  it('rejects malformed frame buffers', () => {
    expect(() => detectRune({ width: 5, height: 5, data: new Uint8ClampedArray(1) }, options)).toThrow()
    expect(() => detectRune({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, options)).toThrow()
  })
})

describe('stable rune presence and one-shot notifications', () => {
  const debounce = { confirmFrames: 3, clearFrames: 8, cooldownMs: 10_000 }
  function samples(state = createRuneState(), seen: boolean | null = true, count = 3, now = 0) {
    let triggered = 0
    for (let index = 0; index < count; index++) {
      const result = advanceRuneState(state, seen, now + index * 250, debounce)
      state = result.state
      triggered += Number(result.triggered)
    }
    return { state, triggered }
  }
  it('waits for three consecutive frames and alerts once while an icon stays visible', () => {
    const first = samples(createRuneState(), true, 2)
    expect(first.triggered).toBe(0)
    expect(first.state.present).toBe(false)
    const confirmed = samples(first.state, true, 20, 500)
    expect(confirmed.triggered).toBe(1)
    expect(confirmed.state.present).toBe(true)
  })
  it('resets an unconfirmed streak when the shape flickers away', () => {
    const first = samples(createRuneState(), true, 2)
    const absent = samples(first.state, false, 1, 500)
    expect(samples(absent.state, true, 2, 750).triggered).toBe(0)
  })
  it('does not rearm for a brief disappearance or an unreadable frame', () => {
    const visible = samples().state
    const shortGap = samples(visible, false, 7, 1000).state
    expect(shortGap.present).toBe(true)
    expect(samples(shortGap, true, 3, 3000).triggered).toBe(0)
    const error = samples(visible, null, 100, 10_000).state
    expect(error.present).toBe(true)
    expect(samples(error, true, 3, 40_000).triggered).toBe(0)
  })
  it('requires continuous valid absence, not capture errors, before rearming', () => {
    const visible = samples().state
    const gap = samples(visible, false, 7, 1000).state
    const error = samples(gap, null, 1, 3000).state
    const stillVisible = samples(error, false, 1, 3250).state
    expect(stillVisible.present).toBe(true)
  })
  it('rearms after stable absence and alerts for a later new appearance', () => {
    const visible = samples().state
    const absent = samples(visible, false, 8, 3000).state
    expect(absent.present).toBe(false)
    expect(samples(absent, true, 3, 12_000).triggered).toBe(1)
  })
  it('suppresses a rapid reappearance during the cooldown without delayed repeats', () => {
    const visible = samples().state
    const absent = samples(visible, false, 8, 1000).state
    const returned = samples(absent, true, 3, 4000)
    expect(returned.triggered).toBe(0)
    expect(returned.state.present).toBe(true)
    expect(samples(returned.state, true, 10, 20_000).triggered).toBe(0)
  })
  it('does not count unreadable frames toward confirmation and never mutates prior state', () => {
    const original = createRuneState()
    const first = samples(original, true, 2)
    const interrupted = samples(first.state, null, 1, 500)
    expect(samples(interrupted.state, true, 2, 750).triggered).toBe(0)
    expect(original).toEqual(createRuneState())
  })
  it('respects configured debounce values and rejects invalid times', () => {
    expect(advanceRuneState(createRuneState(), true, 0, { confirmFrames: 1, clearFrames: 1, cooldownMs: 0 }).triggered).toBe(true)
    expect(() => advanceRuneState(createRuneState(), true, Number.NaN, debounce)).toThrow()
  })
})
