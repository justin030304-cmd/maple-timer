import type { ROI } from '../types'

export interface Point { x: number; y: number }
const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** Reject empty selections and clip selections to the source image. */
export function normalizeROI(roi: ROI): ROI | null {
  if (![roi.x, roi.y, roi.width, roi.height].every(Number.isFinite)) return null
  const x = clamp(Math.min(roi.x, roi.x + roi.width))
  const y = clamp(Math.min(roi.y, roi.y + roi.height))
  const right = clamp(Math.max(roi.x, roi.x + roi.width))
  const bottom = clamp(Math.max(roi.y, roi.y + roi.height))
  if (right - x < 0.005 || bottom - y < 0.005) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** Both points must already be relative to the image content rectangle. */
export function roiFromPoints(start: Point, end: Point): ROI | null {
  return normalizeROI({ x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y })
}

export function roiToPixels(roi: ROI, width: number, height: number) {
  const normalized = normalizeROI(roi)
  if (!normalized || width < 1 || height < 1 || !Number.isFinite(width + height)) return null
  const x = Math.min(width - 1, Math.floor(normalized.x * width))
  const y = Math.min(height - 1, Math.floor(normalized.y * height))
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(normalized.width * width))),
    height: Math.max(1, Math.min(height - y, Math.ceil(normalized.height * height))),
  }
}
