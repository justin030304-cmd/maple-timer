import type { PixelFrame } from './analysis'

/** A heuristic for the small coloured minimap marker, not measured recognition accuracy. */
export interface RuneDetectionOptions {
  color: 'pink-cyan' | 'red'
  minSize: number
  maxSize: number
  minScore: number
}

export interface RuneCandidate {
  x: number
  y: number
  width: number
  height: number
  /** Colour and diamond-shape agreement in [0,1]; never an accuracy percentage. */
  score: number
}

export interface RuneDetection {
  candidate: RuneCandidate | null
  /** Shape candidates before the user's score threshold is applied. */
  candidates: number
}

export const DEFAULT_RUNE_OPTIONS: RuneDetectionOptions = {
  color: 'pink-cyan', minSize: 5, maxSize: 36, minScore: .7,
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

function colourFlags(red: number, green: number, blue: number, alpha: number, mode: RuneDetectionOptions['color']): number {
  if (alpha < 160) return 0
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const difference = high - low
  if (high < 85 || difference / high < .28) return 0
  let hue = high === red ? ((green - blue) / difference) % 6 : high === green ? (blue - red) / difference + 2 : (red - green) / difference + 4
  hue = (hue * 60 + 360) % 360
  if (mode === 'red') return hue <= 20 || hue >= 345 ? 4 : 0
  if (hue >= 160 && hue <= 215) return 1
  if (hue >= 245 && hue <= 345) return 2
  return 0
}

/** Find a small cyan + violet/pink diamond inside a user-selected minimap ROI.
 *
 * The red rectangles in the reference are annotations, not part of the icon.
 * Components require narrow tips, wide middle rows, approximate symmetry and a
 * populated centre. Colour alone, square frames and circles are insufficient.
 * No sample screenshot is bundled: these are conservative colour/shape rules.
 */
export function detectRune(frame: PixelFrame, options: RuneDetectionOptions = DEFAULT_RUNE_OPTIONS): RuneDetection {
  const { width, height, data } = frame
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error('룬 인식을 위한 프레임이 유효하지 않습니다.')
  }
  const minimum = Math.max(3, Math.round(finite(options.minSize, 5)))
  const maximum = Math.max(minimum, Math.round(finite(options.maxSize, 36)))
  const threshold = clamp(finite(options.minScore, .7), 0, 1)
  const total = width * height
  const colours = new Uint8Array(total)
  const white = new Uint8Array(total)
  const joined = new Uint8Array(total)
  const labels = new Int32Array(total)
  const queue = new Int32Array(total)

  for (let index = 0; index < total; index++) {
    const offset = index * 4
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2]
    colours[index] = colourFlags(red, green, blue, data[offset + 3], options.color)
    const high = Math.max(red, green, blue), low = Math.min(red, green, blue)
    white[index] = Number(data[offset + 3] >= 160 && low >= 165 && high - low < 65)
  }
  // Connect coloured edges separated by a one-pixel white outline. This does
  // not enlarge the reported bounds; those still use original coloured pixels.
  for (let index = 0; index < total; index++) {
    if (!colours[index]) continue
    const x = index % width, y = Math.floor(index / width)
    for (let row = Math.max(0, y - 1); row <= Math.min(height - 1, y + 1); row++) {
      for (let column = Math.max(0, x - 1); column <= Math.min(width - 1, x + 1); column++) joined[row * width + column] = 1
    }
  }

  let label = 0
  let best: RuneCandidate | null = null
  let candidates = 0
  for (let origin = 0; origin < total; origin++) {
    if (!joined[origin] || labels[origin]) continue
    label++
    labels[origin] = label
    let head = 0, tail = 1
    queue[0] = origin
    let left = width, top = height, right = -1, bottom = -1, count = 0, cyan = 0, pink = 0
    while (head < tail) {
      const index = queue[head++]
      const x = index % width, y = Math.floor(index / width)
      if (colours[index]) {
        left = Math.min(left, x); top = Math.min(top, y)
        right = Math.max(right, x); bottom = Math.max(bottom, y)
        count++
        if (colours[index] === 1) cyan++
        if (colours[index] === 2) pink++
      }
      for (let row = Math.max(0, y - 1); row <= Math.min(height - 1, y + 1); row++) {
        for (let column = Math.max(0, x - 1); column <= Math.min(width - 1, x + 1); column++) {
          const next = row * width + column
          if (!joined[next] || labels[next]) continue
          labels[next] = label
          queue[tail++] = next
        }
      }
    }
    const markerWidth = right - left + 1, markerHeight = bottom - top + 1
    if (Math.min(markerWidth, markerHeight) < minimum || Math.max(markerWidth, markerHeight) > maximum || count < 6) continue
    const aspect = markerWidth / markerHeight
    if (aspect < .65 || aspect > 1.5) continue
    if (options.color !== 'red' && (cyan < 3 || pink < 3 || Math.min(cyan, pink) / count < .06)) continue

    const middleX = (left + right) / 2, middleY = (top + bottom) / 2
    let rowError = 0, asymmetry = 0, rowCount = 0, supportCount = 0, outside = 0, centrePixels = 0, centreSupport = 0
    for (let row = top; row <= bottom; row++) {
      let rowLeft = right + 1, rowRight = left - 1
      for (let column = left; column <= right; column++) {
        const index = row * width + column
        let supported = colours[index] !== 0 && labels[index] === label
        if (!supported && white[index]) {
          for (let y = Math.max(top, row - 1); y <= Math.min(bottom, row + 1) && !supported; y++) {
            for (let x = Math.max(left, column - 1); x <= Math.min(right, column + 1); x++) {
              const neighbour = y * width + x
              if (colours[neighbour] && labels[neighbour] === label) { supported = true; break }
            }
          }
        }
        const dx = Math.abs(column - middleX) / Math.max(1, (markerWidth - 1) / 2)
        const dy = Math.abs(row - middleY) / Math.max(1, (markerHeight - 1) / 2)
        if (dx <= .4 && dy <= .4) {
          centrePixels++
          if (supported) centreSupport++
        }
        if (!supported) continue
        rowLeft = Math.min(rowLeft, column); rowRight = Math.max(rowRight, column)
        supportCount++
        if (dx + dy > 1.35) outside++
      }
      if (rowRight < rowLeft) { rowError += 1; continue }
      rowCount++
      const actualSpan = (rowRight - rowLeft + 1) / markerWidth
      const expectedSpan = Math.max(1 / markerWidth, 1 - Math.abs(row - middleY) / Math.max(1, (markerHeight - 1) / 2))
      rowError += Math.abs(actualSpan - expectedSpan)
      asymmetry += Math.abs(rowLeft + rowRight - 2 * middleX) / markerWidth
    }
    rowError /= markerHeight
    asymmetry /= Math.max(1, rowCount)
    const outsideFraction = outside / Math.max(1, supportCount)
    const centreCoverage = centreSupport / Math.max(1, centrePixels)
    // A marker clipped by the ROI or attached to a larger map shape should not
    // be accepted as a partial diamond. Draw a little margin around the icon.
    if (left === 0 || top === 0 || right === width - 1 || bottom === height - 1) continue
    if (rowCount / markerHeight < .8 || rowError > .18 || asymmetry > .28 || outsideFraction > .16 || centreCoverage < .25) continue

    const boundaryScore = clamp(1 - rowError / .32, 0, 1)
    const symmetryScore = clamp(1 - asymmetry * 2, 0, 1)
    const cornerScore = clamp(1 - outsideFraction * 4, 0, 1)
    const paletteScore = options.color === 'red' ? 1 : clamp(Math.min(cyan, pink) / count / .15, 0, 1)
    const centreScore = clamp(centreCoverage / .65, 0, 1)
    const score = clamp(boundaryScore * .55 + symmetryScore * .15 + cornerScore * .1 + paletteScore * .1 + centreScore * .1, 0, 1)
    candidates++
    if (score >= threshold && (!best || score > best.score)) best = { x: left, y: top, width: markerWidth, height: markerHeight, score }
  }
  return { candidate: best, candidates }
}

export interface RunePresenceState {
  present: boolean
  seenFrames: number
  missingFrames: number
  lastAlertAt: number | null
}

export interface RunePresenceOptions {
  confirmFrames: number
  clearFrames: number
  cooldownMs: number
}

export const DEFAULT_RUNE_PRESENCE_OPTIONS: RunePresenceOptions = { confirmFrames: 3, clearFrames: 8, cooldownMs: 10_000 }
export const createRuneState = (): RunePresenceState => ({ present: false, seenFrames: 0, missingFrames: 0, lastAlertAt: null })

/** null means unreadable/no frame: never mistake capture failures for absence. */
export function advanceRuneState(previous: RunePresenceState, seen: boolean | null, nowMs: number, options: RunePresenceOptions = DEFAULT_RUNE_PRESENCE_OPTIONS): { state: RunePresenceState; triggered: boolean } {
  if (!Number.isFinite(nowMs)) throw new Error('룬 감지 시간이 유효하지 않습니다.')
  const confirmFrames = Math.max(1, Math.round(finite(options.confirmFrames, 3)))
  const clearFrames = Math.max(1, Math.round(finite(options.clearFrames, 8)))
  const cooldownMs = Math.max(0, finite(options.cooldownMs, 10_000))
  const state = { ...previous }
  if (seen === null) return { state: { ...state, seenFrames: 0, missingFrames: 0 }, triggered: false }
  if (!seen) {
    state.seenFrames = 0
    state.missingFrames = Math.min(clearFrames, state.missingFrames + 1)
    if (state.missingFrames >= clearFrames) state.present = false
    return { state, triggered: false }
  }
  state.missingFrames = 0
  state.seenFrames = Math.min(confirmFrames, state.seenFrames + 1)
  if (state.present || state.seenFrames < confirmFrames) return { state, triggered: false }
  state.present = true
  const triggered = state.lastAlertAt === null || nowMs - state.lastAlertAt >= cooldownMs
  if (triggered) state.lastAlertAt = nowMs
  return { state, triggered }
}
