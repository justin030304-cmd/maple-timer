import { describe, it, expect } from 'vitest'
import { experienceGlyphs, glyphDifference, locateExperienceRegion } from './experienceVisual'
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
  it('does not invent an automatic region without a lime experience strip', () => {
    expect(locateExperienceRegion(digits([0, 0, 0]))).toBeNull()
  })
})
