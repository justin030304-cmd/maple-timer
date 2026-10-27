import { describe, expect, it } from 'vitest'
import { prepareExperienceImage } from './experienceImage'
import type { PixelFrame } from './analysis'

type Color = [number, number, number, number?]
const background = (width: number, height: number, color: Color): PixelFrame => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set([color[0], color[1], color[2], color[3] ?? 255], offset)
  return { width, height, data }
}
function rectangle(frame: PixelFrame, x: number, y: number, width: number, height: number, color: Color) {
  for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
    frame.data.set([color[0], color[1], color[2], color[3] ?? 255], (row * frame.width + column) * 4)
  }
}
/** A small numeral-like line including separated strokes and a one-pixel dot. */
function glyphs(frame: PixelFrame, color: Color = [255, 255, 255]) {
  rectangle(frame, 25, 8, 2, 11, color)
  rectangle(frame, 32, 8, 7, 2, color)
  rectangle(frame, 37, 10, 2, 4, color)
  rectangle(frame, 32, 13, 7, 2, color)
  rectangle(frame, 32, 15, 2, 4, color)
  rectangle(frame, 32, 18, 7, 2, color)
  rectangle(frame, 43, 19, 1, 1, color)
  rectangle(frame, 49, 8, 2, 12, color)
  return frame
}
const blackPixels = (frame: PixelFrame) => Array.from(frame.data).filter((value, index) => index % 4 === 0 && value === 0).length

describe('experience numeric image preparation', () => {
  it('produces black glyphs on an opaque white image with a clean margin', () => {
    const output = prepareExperienceImage(glyphs(background(120, 32, [100, 155, 12])))
    expect(output.width).toBeGreaterThan(120)
    expect(output.height).toBeGreaterThan(60)
    expect(blackPixels(output)).toBeGreaterThan(100)
    for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
      const offset = (y * output.width + x) * 4
      expect(output.data[offset + 3]).toBe(255)
      expect([0, 255]).toContain(output.data[offset])
      expect(output.data[offset + 1]).toBe(output.data[offset])
      expect(output.data[offset + 2]).toBe(output.data[offset])
      if (x < 12 || y < 12 || x >= output.width - 12 || y >= output.height - 12) expect(output.data[offset]).toBe(255)
    }
  })
  it('does not turn green bar animation or brightness changes into changed text', () => {
    const dark = prepareExperienceImage(glyphs(background(120, 32, [50, 90, 10])))
    const bright = prepareExperienceImage(glyphs(background(120, 32, [156, 206, 0])))
    const yellowGreen = prepareExperienceImage(glyphs(background(120, 32, [199, 235, 30])))
    expect(bright).toEqual(dark)
    expect(yellowGreen).toEqual(dark)
  })
  it('preserves off-white and dim neutral grey glyph shapes', () => {
    const white = prepareExperienceImage(glyphs(background(120, 32, [0, 0, 0])))
    const offWhite = prepareExperienceImage(glyphs(background(120, 32, [91, 130, 12]), [238, 232, 192]))
    const grey = prepareExperienceImage(glyphs(background(120, 32, [0, 0, 0]), [164, 164, 164]))
    expect(offWhite).toEqual(white)
    expect(grey).toEqual(white)
  })
  it('keeps one-pixel decimal punctuation instead of deleting small components', () => {
    const withDot = glyphs(background(120, 32, [80, 140, 10]))
    const withoutDot = glyphs(background(120, 32, [80, 140, 10]))
    rectangle(withoutDot, 43, 19, 1, 1, [80, 140, 10])
    expect(blackPixels(prepareExperienceImage(withDot)) - blackPixels(prepareExperienceImage(withoutDot))).toBe(36)
  })
  it('removes long thin EXP bar borders while leaving digit strokes intact', () => {
    const clean = glyphs(background(120, 32, [100, 155, 12]))
    const bordered = glyphs(background(120, 32, [100, 155, 12]))
    rectangle(bordered, 0, 0, 120, 1, [255, 255, 255])
    rectangle(bordered, 0, 31, 120, 1, [255, 255, 255])
    rectangle(bordered, 0, 0, 1, 32, [255, 255, 255])
    rectangle(bordered, 119, 0, 1, 32, [255, 255, 255])
    expect(prepareExperienceImage(bordered)).toEqual(prepareExperienceImage(clean))
  })
  it('trims blank bar margins without modifying the source data', () => {
    const source = glyphs(background(2048, 32, [90, 150, 0]))
    const before = source.data.slice()
    const prepared = prepareExperienceImage(source)
    expect(prepared).toEqual(prepareExperienceImage(glyphs(background(120, 32, [90, 150, 0]))))
    expect(source.data).toEqual(before)
  })
  it('bounds wide numeric output to 2400 by 400 pixels', () => {
    const source = background(4000, 200, [100, 155, 12])
    for (let x = 10; x < 3990; x += 20) rectangle(source, x, 30, 3, 140, [255, 255, 255])
    const output = prepareExperienceImage(source)
    expect(output.width).toBeLessThanOrEqual(2400)
    expect(output.height).toBeLessThanOrEqual(400)
    expect(blackPixels(output)).toBeGreaterThan(0)
  })
  it('can retain antialiased thin glyph edges without treating the green bar as text', () => {
    const source = glyphs(background(120, 32, [100, 155, 12]))
    rectangle(source, 24, 8, 1, 11, [139, 180, 73])
    const binary = prepareExperienceImage(source)
    const antialiased = prepareExperienceImage(source, { preserveAntialias: true })
    expect(Array.from(binary.data).some((value, index) => index % 4 === 0 && value > 0 && value < 255)).toBe(false)
    expect(Array.from(antialiased.data).some((value, index) => index % 4 === 0 && value > 0 && value < 255)).toBe(true)
    expect(antialiased.height).toBeLessThanOrEqual(64)
    expect(blackPixels(antialiased)).toBeGreaterThan(0)
  })
  it.each([60, 100, 140, 180])('removes dim %s-level bar rules restored by grayscale without changing glyphs', level => {
    const clean = glyphs(background(120, 32, [100, 155, 12]))
    const bordered = glyphs(background(120, 32, [100, 155, 12]))
    rectangle(bordered, 0, 2, 120, 2, [level, level, level])
    rectangle(bordered, 0, 28, 120, 2, [level, level, level])
    expect(prepareExperienceImage(bordered, { preserveAntialias: true }))
      .toEqual(prepareExperienceImage(clean, { preserveAntialias: true }))
  })
  it('normalizes varying green backgrounds in the antialias-preserving variant', () => {
    const dark = prepareExperienceImage(glyphs(background(120, 32, [50, 90, 10])), { preserveAntialias: true })
    const bright = prepareExperienceImage(glyphs(background(120, 32, [156, 206, 0])), { preserveAntialias: true })
    expect(bright).toEqual(dark)
    expect(() => prepareExperienceImage(background(120, 32, [156, 206, 0]), { preserveAntialias: true })).toThrow()
  })
  it('rejects empty, transparent and obscured images instead of inventing numerals', () => {
    for (const frame of [background(120, 32, [156, 206, 0]), background(120, 32, [0, 0, 0]), background(120, 32, [255, 255, 255]), glyphs(background(120, 32, [0, 0, 0]), [255, 255, 255, 0])]) {
      expect(() => prepareExperienceImage(frame)).toThrow(/경험치 숫자/)
    }
  })
  it('rejects corrupt input and an overly broad game-screen crop', () => {
    expect(() => prepareExperienceImage({ width: 20, height: 20, data: new Uint8ClampedArray(4) })).toThrow(/유효하지/)
    expect(() => prepareExperienceImage({ width: NaN, height: 20, data: new Uint8ClampedArray(4) })).toThrow(/유효하지/)
    expect(() => prepareExperienceImage(background(1280, 720, [0, 0, 0]))).toThrow(/너무 큽니다/)
  })
})
