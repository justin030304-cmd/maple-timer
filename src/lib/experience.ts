/** Experience is kept as decimal text: actual game values can exceed 2^53. */
export interface ExperienceValue {
  key: string
  value: string
  kind: 'absolute' | 'percent'
  display: string
}

const integerPattern = '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)'
const absoluteOnly = new RegExp(`^(${integerPattern})$`)
const percentToken = /^([\[(]?)\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*([\])\s]*)$/
const combined = new RegExp(`^(${integerPattern})(?:\\s+(.+)|\\s*(\\[.+|\\(.+))$`)
const stripLeadingZeroes = (value: string) => value.replace(/^0+(?=[0-9])/, '')

function absoluteValue(text: string): ExperienceValue {
  const value = stripLeadingZeroes(text.replaceAll(',', ''))
  return { key: `abs:${value}`, value, kind: 'absolute', display: value.replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ',') }
}

function percentageValue(text: string): ExperienceValue | null {
  const [wholeText, fractionText = ''] = text.split('.')
  const whole = stripLeadingZeroes(wholeText)
  const fraction = fractionText.replace(/0+$/, '')
  if (BigInt(whole) > 100n || (whole === '100' && fraction !== '')) return null
  const value = fraction ? `${whole}.${fraction}` : whole
  return { key: `percent:${value}`, value, kind: 'percent', display: `${value}%` }
}

function parsePercentageToken(text: string): ExperienceValue | null {
  const match = percentToken.exec(text)
  if (!match) return null
  const [, opener, value, suffix] = match
  const closers = suffix.replace(/\s/g, '')
  // Tesseract may read a correct closing ] as )] or ]). Only tolerate
  // extra closing wrappers after an explicitly opened percentage. Missing
  // closers, stray opening characters and bare-number suffixes stay invalid.
  if (opener === '[' ? !closers.includes(']') : opener === '(' ? !closers.includes(')') : closers !== '') return null
  return percentageValue(value)
}

/** Parse the entire numeric ROI, never extract a plausible number from junk.
 * Commas must form valid thousands groups; percentages require an explicit %.
 * A valid absolute value wins over its rounded percentage companion. */
export function parseExperienceText(text: string): ExperienceValue | null {
  if (typeof text !== 'string' || text.length > 512) return null
  const normalized = text.normalize('NFKC').trim()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\.\s*/g, '.')
    // Two or more complete thousands groups cannot be a decimal percentage.
    .replace(/^[0-9]{1,3}(?:\.[0-9]{3}){2,}(?=\s|[[(]|$)/, token => token.replaceAll('.', ','))
  if (!normalized || !/^[0-9,.\[\]()%\s]+$/.test(normalized)) return null
  const absolute = absoluteOnly.exec(normalized)
  if (absolute) return absoluteValue(absolute[1])
  if (percentToken.test(normalized)) return parsePercentageToken(normalized)
  const row = combined.exec(normalized)
  if (!row) return null
  // Broken percentages often indicate a wrongly cropped or badly read row.
  if (!parsePercentageToken(row[2] ?? row[3])) return null
  return absoluteValue(row[1])
}

export interface ExperienceReading {
  value: ExperienceValue
  confidence: number
}

export interface ExperienceState {
  /** Last confirmed value, retained for display during an unreadable interval. */
  value: ExperienceValue | null
  lastChangedAt: number | null
  /** Updated only when the current reading agrees with a confirmed value. */
  lastReadAt: number | null
  valid: boolean
  pendingKey: string | null
  pendingReadings: number
  lastSampleAt: number | null
}

export interface ExperienceOptions {
  confirmReadings: number
  maxGapMs: number
}

export const DEFAULT_EXPERIENCE_OPTIONS: ExperienceOptions = { confirmReadings: 2, maxGapMs: 4000 }
export const MIN_EXPERIENCE_CONFIDENCE = 70
export const createExperienceState = (): ExperienceState => ({
  value: null, lastChangedAt: null, lastReadAt: null, valid: false,
  pendingKey: null, pendingReadings: 0, lastSampleAt: null,
})

/** Two matching good reads confirm a value. Unreadable samples and long gaps
 * invalidate the inactivity epoch instead of pretending the number stayed still.
 * A short confident OCR flicker does not count as an actual experience change. */
export function advanceExperienceState(
  previous: ExperienceState,
  reading: ExperienceReading | null,
  nowMs: number,
  options: ExperienceOptions = DEFAULT_EXPERIENCE_OPTIONS,
): { state: ExperienceState; changed: boolean; confirmed: boolean } {
  if (!Number.isFinite(nowMs)) throw new Error('경험치 인식 시간이 유효하지 않습니다.')
  const confirmReadings = Number.isFinite(options.confirmReadings) ? Math.max(1, Math.round(options.confirmReadings)) : 2
  const maxGapMs = Number.isFinite(options.maxGapMs) ? Math.max(1, options.maxGapMs) : 4000
  const rolledBack = previous.lastSampleAt !== null && nowMs < previous.lastSampleAt
  const stale = previous.lastReadAt !== null && nowMs - previous.lastReadAt > maxGapMs
  const sampleGap = previous.lastSampleAt !== null && nowMs - previous.lastSampleAt > maxGapMs
  const state: ExperienceState = { ...previous, valid: false, lastSampleAt: nowMs }
  if (rolledBack || stale) state.lastChangedAt = null
  const good = reading && Number.isFinite(reading.confidence) && reading.confidence >= MIN_EXPERIENCE_CONFIDENCE && reading.confidence <= 100
  if (!good) {
    state.lastChangedAt = null
    state.pendingKey = null
    state.pendingReadings = 0
    return { state, changed: false, confirmed: false }
  }

  const samePending = !rolledBack && !sampleGap && previous.pendingKey === reading.value.key
  state.pendingKey = reading.value.key
  state.pendingReadings = samePending ? Math.min(confirmReadings, previous.pendingReadings + 1) : 1
  if (state.pendingReadings < confirmReadings) return { state, changed: false, confirmed: false }

  const changed = previous.value !== null && previous.value.key !== reading.value.key
  state.value = reading.value
  state.valid = true
  state.lastReadAt = nowMs
  if (changed || state.lastChangedAt === null) state.lastChangedAt = nowMs
  return { state, changed, confirmed: true }
}
