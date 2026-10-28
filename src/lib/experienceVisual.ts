import type { PixelFrame } from './analysis'
import type { ROI } from '../types'

const pale = (r: number, g: number, b: number) => Math.min(r, g, b) >= 100 && Math.max(r, g, b) - Math.min(r, g, b) <= 70

/** Locate a bottom lime EXP strip and its nearby pale numeric row. */
export function locateExperienceRegion(frame: PixelFrame, barHintY?: number): ROI | null {
  const { width, height, data } = frame
  if (data.length !== width * height * 4) return null
  let barY = -1
  const hinted = barHintY !== undefined && Number.isFinite(barHintY)
  const centre = hinted ? Math.round(Math.max(0, Math.min(1, barHintY)) * (height - 1)) : height - 1
  const radius = Math.max(16, Math.round(height * .035))
  const startY = hinted ? Math.min(height - 1, centre + radius) : height - 1
  const endY = hinted ? Math.max(0, centre - radius) : Math.floor(height * .85)
  let bestDistance = Infinity
  for (let y = startY; y >= endY; y--) {
    let run = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      run = g > 100 && r > 45 && g >= r * .95 && b < g * .5 ? run + 1 : 0
      if (run >= Math.max(30, width * .025)) {
        if (!hinted || Math.abs(y - centre) < bestDistance) { barY = y; bestDistance = Math.abs(y - centre) }
        break
      }
    }
    if (barY >= 0 && !hinted) break
  }
  if (barY < 0) return null
  let top = Math.max(0, barY - Math.max(16, Math.round(height * .03)))
  let bottom = Math.min(height - 1, barY + Math.max(16, Math.round(height * .03)))
  // A click targets the bar's TOP edge, not its bottom. Search both sides,
  // then isolate the closest text line so HP/MP above it cannot join the ROI.
  const lines: { top: number; bottom: number; distance: number }[] = []
  let lineStart = -1
  for (let y = top; y <= bottom + 1; y++) {
    let hits = 0
    if (y <= bottom) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (pale(data[i], data[i + 1], data[i + 2])) hits++
    }
    const active = hits >= 3 && hits < width * .65
    if (active && lineStart < 0) lineStart = y
    if (!active && lineStart >= 0) {
      if (y - lineStart >= 5 && y - lineStart <= 60) lines.push({ top: lineStart, bottom: y - 1, distance: Math.max(0, lineStart - barY, barY - (y - 1)) })
      lineStart = -1
    }
  }
  lines.sort((a, b) => a.distance - b.distance)
  if (!lines.length) return null
  top = lines[0].top; bottom = lines[0].bottom
  const columns = new Uint16Array(width)
  for (let y = top; y <= bottom; y++) {
    let hits = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (pale(data[i], data[i + 1], data[i + 2])) hits++
    }
    if (hits > width * .65) continue
    for (let x = Math.floor(width * .15); x < width * .85; x++) {
      const i = (y * width + x) * 4
      if (pale(data[i], data[i + 1], data[i + 2])) columns[x]++
    }
  }
  let best: { left: number; right: number; score: number } | null = null
  const glyphGap = Math.max(8, Math.round((bottom - top) * .9))
  let start = -1, last = -1
  for (let x = 0; x <= width; x++) {
    if (x < width && columns[x] > 0) { if (start < 0) start = x; last = x }
    if (start >= 0 && (x - last > glyphGap || x === width)) {
      const span = last - start + 1
      if (span >= 45 && span <= width * .55) {
        const score = span / (1 + Math.abs((start + last) / 2 - width / 2) / width * 5)
        if (!best || score > best.score) best = { left: start, right: last, score }
      }
      start = -1
    }
  }
  if (!best) return null
  const left = Math.max(0, best.left - 3), right = Math.min(width, best.right + 4)
  // Trim to the glyph rows, rather than including the HP/MP rows above them.
  let first = height, lastRow = -1
  for (let y = top; y <= bottom; y++) {
    let hits = 0
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4
      if (pale(data[i], data[i + 1], data[i + 2])) hits++
    }
    if (hits >= 3 && hits < (right - left) * .7) { first = Math.min(first, y); lastRow = y }
  }
  if (lastRow - first < 4 || lastRow - first > 60) return null
  const y = Math.max(0, first - 2), end = Math.min(height, lastRow + 3)
  return { x: left / width, y: y / height, width: (right - left) / width, height: (end - y) / height }
}

export interface GlyphSample { mask: Uint8Array; width: number; height: number; ink: number }
/** Compare only pale digit strokes. Green fill and bar length are excluded. */
export function experienceGlyphs(frame: PixelFrame): GlyphSample {
  const { width, height, data } = frame
  if (width < 30 || height < 5 || height > 80 || width > 4096 || data.length !== width * height * 4) throw new Error('경험치 숫자 한 줄만 포함하도록 영역을 지정해 주세요.')
  const mask = new Uint8Array(width * height)
  // Compression changes dark antialias pixels much more than the pale strokes.
  // Retain support for dim captures while using a steadier core on bright text.
  let brightest = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 160 && pale(data[i], data[i + 1], data[i + 2])) brightest = Math.max(brightest, Math.min(data[i], data[i + 1], data[i + 2]))
  }
  const threshold = Math.max(100, Math.min(140, brightest * .75))
  for (let y = 0; y < height; y++) {
    let start = -1
    for (let x = 0; x <= width; x++) {
      const i = y * width + x, offset = i * 4
      const foreground = x < width && data[offset + 3] >= 160 && Math.min(data[offset], data[offset + 1], data[offset + 2]) >= threshold && pale(data[offset], data[offset + 1], data[offset + 2])
      if (foreground) { mask[i] = 1; if (start < 0) start = x }
      else if (start >= 0) { if (x - start > width * .65) mask.fill(0, y * width + start, i); start = -1 }
    }
  }
  let ink = 0, groups = 0, inside = false
  for (let x = 0; x < width; x++) {
    let hits = 0
    for (let y = 0; y < height; y++) hits += mask[y * width + x]
    ink += hits
    if (hits && !inside) groups++
    inside = hits > 0
  }
  if (groups < 4 || ink < 25 || ink / mask.length > .65) throw new Error('경험치 숫자 모양을 확인하지 못했습니다. 영역과 가림 여부를 확인해 주세요.')
  return { mask, width, height, ink }
}
export function glyphDifference(a: GlyphSample, b: GlyphSample): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let i = 0; i < a.mask.length; i++) changed += Math.abs(a.mask[i] - b.mask[i])
  return changed / Math.max(a.ink, b.ink, 1)
}

/** A single changing digit must not be diluted by the many unchanged digits. */
export function experienceGlyphsChanged(a: GlyphSample, b: GlyphSample): boolean {
  if (glyphDifference(a, b) > .08) return true
  let top = a.height, bottom = -1
  const changes = new Uint16Array(a.width), inkA = new Uint16Array(a.width), inkB = new Uint16Array(a.width)
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const index = y * a.width + x, before = a.mask[index], after = b.mask[index]
    changes[x] += Math.abs(before - after); inkA[x] += before; inkB[x] += after
    if (before || after) { top = Math.min(top, y); bottom = Math.max(bottom, y) }
  }
  const span = Math.max(5, bottom - top + 1), window = Math.min(a.width, span)
  let changed = 0, before = 0, after = 0
  for (let x = 0; x < a.width; x++) {
    changed += changes[x]; before += inkA[x]; after += inkB[x]
    if (x >= window) { changed -= changes[x - window]; before -= inkA[x - window]; after -= inkB[x - window] }
    const strokes = Math.max(before, after)
    if (x >= window - 1 && strokes >= 12 && changed >= Math.max(4, Math.ceil(span * .35)) && changed / strokes > .12) return true
  }
  return false
}
