import { describe, it, expect } from 'vitest'
import { experienceGlyphs, experienceGlyphsChanged, glyphDifference, locateExperienceRegion } from './experienceVisual'
import type { PixelFrame } from './analysis'
function digits(background = [90, 160, 10]): PixelFrame {
  const width = 120, height = 20, data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...background, 255], i)
  for (let x = 8; x < 108; x += 9) for (let y = 5; y < 15; y++) for (let dx = 0; dx < 3; dx++) data.set([230, 230, 235, 255], (y * width + x + dx) * 4)
  return { width, height, data }
}
describe('small experience digit shapes', () => {
  it('ignores green fill brightness while retaining pale digit strokes', () => {
    expect(glyphDifference(experienceGlyphs(digits()), experienceGlyphs(digits([170, 220, 0])))).toBe(0)
  })
  it('distinguishes changed strokes from an identical frame', () => {
    const a = digits(), b = digits()
    for (let y = 5; y < 15; y++) for (let x = 8; x < 20; x++) b.data.set([90, 160, 10, 255], (y * b.width + x) * 4)
    expect(glyphDifference(experienceGlyphs(a), experienceGlyphs(b))).toBeGreaterThan(.08)
  })
  it('rejects blank, covered, and broad crops', () => {
    const a = digits(); a.data.fill(0)
    expect(() => experienceGlyphs(a)).toThrow()
    expect(() => experienceGlyphs({ ...a, height: 100 })).toThrow()
  })
  it('detects a small stroke change diluted by a long unchanged number', () => {
    const a = digits(), b = digits()
    for (let y = 5; y < 10; y++) b.data.set([90, 160, 10, 255], (y * b.width + 8) * 4)
    const before = experienceGlyphs(a), after = experienceGlyphs(b)
    expect(glyphDifference(before, after)).toBeLessThan(.08)
    expect(experienceGlyphsChanged(before, after)).toBe(true)
  })
  it('ignores isolated noise pixels and retains dim digit strokes', () => {
    const a = digits(), b = digits()
    b.data.set([90, 160, 10, 255], (5 * b.width + 8) * 4)
    b.data.set([90, 160, 10, 255], (6 * b.width + 8) * 4)
    expect(experienceGlyphsChanged(experienceGlyphs(a), experienceGlyphs(b))).toBe(false)
    for (let i = 0; i < a.data.length; i += 4) if (a.data[i] === 230) a.data.set([130, 130, 135, 255], i)
    expect(experienceGlyphs(a).ink).toBe(experienceGlyphs(digits()).ink)
  })
  it('does not invent an automatic region without a lime experience strip', () => {
    expect(locateExperienceRegion(digits([0, 0, 0]))).toBeNull()
  })
})

describe('experience bar click selection', () => {
  function floatingBar(): PixelFrame {
    const width = 640, height = 360, data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) data.set([25, 30, 27, 255], i)
    for (let y = 178; y < 191; y++) for (let x = 10; x < 620; x++) data.set([170, 220, 10, 255], (y * width + x) * 4)
    for (let x = 260; x < 380; x += 8) for (let y = 180; y < 189; y++) for (let dx = 0; dx < 3; dx++) data.set([240, 240, 240, 255], (y * width + x + dx) * 4)
    return { width, height, data }
  }
  it('finds a floating bar near the clicked line rather than assuming screen bottom', () => {
    const sample = floatingBar()
    expect(locateExperienceRegion(sample)).toBeNull()
    const roi = locateExperienceRegion(sample, 178 / 360)
    expect(roi).not.toBeNull()
    expect(roi!.y).toBeCloseTo(178 / 360, 2)
    expect(roi!.width).toBeGreaterThan(.15)
    expect(roi!.height).toBeLessThan(.06)
  })
  it('does not invent a region when the clicked line has no bar', () => {
    expect(locateExperienceRegion(floatingBar(), .2)).toBeNull()
  })
})
