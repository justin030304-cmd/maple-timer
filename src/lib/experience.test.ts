import { describe, expect, it } from 'vitest'
import {
  advanceExperienceState, createExperienceState, parseExperienceText,
} from './experience'
import type { ExperienceReading, ExperienceState } from './experience'

const reading = (text: string, confidence = 95): ExperienceReading => ({ value: parseExperienceText(text)!, confidence })
const step = (state: ExperienceState, text: string | null, time: number, confidence = 95) => advanceExperienceState(state, text === null ? null : reading(text, confidence), time)
function baseline(text = '123,456', at = 1000) {
  const first = step(createExperienceState(), text, at - 1000).state
  return step(first, text, at).state
}

describe('numeric experience parsing', () => {
  it('preserves every absolute digit beyond safe JavaScript integer precision', () => {
    expect(parseExperienceText('586,571,406,212,585 [67.391%]')).toEqual({
      key: 'abs:586571406212585', value: '586571406212585', kind: 'absolute', display: '586,571,406,212,585',
    })
    expect(parseExperienceText('999,999,999,999,999,999,991 [67.391%]')!.value).toBe('999999999999999999991')
    expect(parseExperienceText('999,999,999,999,999,999,992 [67.391%]')!.value).toBe('999999999999999999992')
  })
  it('prefers the absolute counter when only its rounded percentage changes', () => {
    expect(parseExperienceText('123,456 [10.000%]')!.key).toBe(parseExperienceText('123456 [10.001%]')!.key)
    expect(parseExperienceText('123,457 [10.000%]')!.key).not.toBe(parseExperienceText('123456 [10.000%]')!.key)
  })
  it.each(['[67.391%)]', '[67.391%])', '(67.391%])'])('tolerates extra closing OCR wrappers around %s without changing digits', percentage => {
    expect(parseExperienceText(`586,571,406,212,585 ${percentage}`)).toMatchObject({ key: 'abs:586571406212585' })
    expect(parseExperienceText(percentage)).toMatchObject({ key: 'percent:67.391' })
  })
  it.each([
    ['589.962.110.687.476 [7.780%]', 'abs:589962110687476', '589,962,110,687,476'],
    ['589.962.110.687.476', 'abs:589962110687476', '589,962,110,687,476'],
    ['000000', 'abs:0', '0'],
    ['000123', 'abs:123', '123'],
    ['123456789', 'abs:123456789', '123,456,789'],
    [' 123, 456, 789 ( 67.391 % )\n', 'abs:123456789', '123,456,789'],
    ['１２３，４５６［６７．３９１％］', 'abs:123456', '123,456'],
    ['123456 67.391%', 'abs:123456', '123,456'],
    ['67.391%', 'percent:67.391', '67.391%'],
    ['[067.3900%]', 'percent:67.39', '67.39%'],
    ['(0.0000%)', 'percent:0', '0%'],
    ['100.000%', 'percent:100', '100%'],
    ['[ 67 . 391 % ]', 'percent:67.391', '67.391%'],
  ])('normalizes %s without numeric rounding', (text, key, display) => {
    expect(parseExperienceText(text)).toMatchObject({ key, display })
  })
  it.each([
    '', '  ', 'EXP 123,456', '123O456', '1I2', '12,34', '1234,567', '123 456',
    '67.391', '67,391%', '-1', '+123', '101%', '100.001%', '-0.1%',
    '123 [101%]', '123 [67.391%', '123 67.391% 42', '123/456', '123:456',
    '123 [67%%]', '12.3.4%', '123 [ ]', '[123]', '123 [67.391%)', '67.391%)]',
    '123 [67.391%)(]', '123 [67.391%]42', '1'.repeat(513),
  ])('rejects ambiguous, malformed, or out-of-range OCR text %s', text => {
    expect(parseExperienceText(text)).toBeNull()
  })
})

describe('stable numeric inactivity tracking', () => {
  it('waits for two agreeing readings before creating an inactivity epoch', () => {
    const first = step(createExperienceState(), '123,456', 0)
    expect(first).toMatchObject({ confirmed: false, changed: false, state: { valid: false, value: null, lastChangedAt: null } })
    const second = step(first.state, '123,456', 1000)
    expect(second).toMatchObject({ confirmed: true, changed: false, state: { valid: true, lastChangedAt: 1000, lastReadAt: 1000 } })
  })
  it('refreshes same-value read freshness without resetting the inactivity epoch', () => {
    let state = baseline()
    for (const time of [2000, 3000, 4000, 5000, 6000]) state = step(state, '123,456', time).state
    expect(state).toMatchObject({ valid: true, lastReadAt: 6000, lastChangedAt: 1000 })
  })
  it('confirms a numeric increase before resetting inactivity', () => {
    const firstChange = step(baseline(), '123,457', 2000)
    expect(firstChange).toMatchObject({ changed: false, confirmed: false, state: { valid: false, lastChangedAt: 1000 } })
    expect(firstChange.state.value!.key).toBe('abs:123456')
    const next = step(firstChange.state, '123,457', 3000)
    expect(next).toMatchObject({ changed: true, confirmed: true, state: { valid: true, lastChangedAt: 3000, lastReadAt: 3000 } })
    expect(next.state.value!.key).toBe('abs:123457')
  })
  it('treats a confirmed lower value or a reset to zero as a real change', () => {
    const first = step(baseline(), '0', 2000).state
    const next = step(first, '0', 3000)
    expect(next.changed).toBe(true)
    expect(next.state).toMatchObject({ valid: true, lastChangedAt: 3000, value: { value: '0' } })
  })
  it('does not invent activity from a single confident OCR flicker', () => {
    const flicker = step(baseline(), '123,458', 2000).state
    const firstRecovery = step(flicker, '123,456', 3000).state
    expect(firstRecovery.valid).toBe(false)
    const recovered = step(firstRecovery, '123,456', 4000)
    expect(recovered).toMatchObject({ changed: false, confirmed: true, state: { valid: true, lastChangedAt: 1000 } })
  })
  it('does not count changes in formatting or in the secondary percentage', () => {
    const state = baseline('123,456 [67.391%]')
    const next = step(state, '123456 [67.3920%]', 2000)
    expect(next).toMatchObject({ confirmed: true, changed: false, state: { lastChangedAt: 1000 } })
  })
  it.each([0, 69.99, Number.NaN, Number.POSITIVE_INFINITY, 101])('invalidates a confidence of %s instead of counting it as no change', confidence => {
    const next = step(baseline(), '123,456', 2000, confidence)
    expect(next).toMatchObject({ confirmed: false, changed: false, state: { valid: false, lastChangedAt: null, pendingReadings: 0 } })
    expect(next.state.value!.key).toBe('abs:123456')
  })
  it('accepts the confidence threshold of 70', () => {
    expect(step(baseline(), '123456', 2000, 70).state.valid).toBe(true)
  })
  it('retains a displayed value during failure and starts a fresh epoch after recovery', () => {
    const failed = step(baseline(), null, 2000).state
    expect(failed).toMatchObject({ valid: false, lastChangedAt: null, lastReadAt: 1000, pendingKey: null })
    const first = step(failed, '123456', 3000).state
    expect(first.valid).toBe(false)
    const recovered = step(first, '123456', 4000)
    expect(recovered).toMatchObject({ changed: false, confirmed: true, state: { valid: true, lastChangedAt: 4000, lastReadAt: 4000 } })
  })
  it('does not alert immediately after a long gap with no OCR callbacks', () => {
    const first = step(baseline(), '123456', 20_000).state
    expect(first).toMatchObject({ valid: false, lastChangedAt: null })
    const recovered = step(first, '123456', 21_000).state
    expect(recovered).toMatchObject({ valid: true, lastChangedAt: 21_000, lastReadAt: 21_000 })
  })
  it('does not confirm two readings separated by a long gap before the first baseline', () => {
    const first = step(createExperienceState(), '123456', 0).state
    const late = step(first, '123456', 20_000).state
    expect(late.valid).toBe(false)
    expect(late.pendingReadings).toBe(1)
  })
  it('starts fresh after a long run of confident but inconsistent readings', () => {
    let state = baseline()
    for (const [value, time] of [['123457', 2000], ['123458', 3000], ['123459', 4000], ['123460', 5000], ['123461', 6000]] as const) {
      state = step(state, value, time).state
      expect(state.valid).toBe(false)
    }
    expect(state.lastChangedAt).toBeNull()
    state = step(state, '123456', 7000).state
    state = step(state, '123456', 8000).state
    expect(state).toMatchObject({ valid: true, lastChangedAt: 8000 })
  })
  it('compares extremely large absolute counters by their exact canonical key', () => {
    const before = '999999999999999999991'
    const after = '999999999999999999992'
    const candidate = step(baseline(before), after, 2000).state
    const next = step(candidate, after, 3000)
    expect(next.changed).toBe(true)
    expect(next.state.value!.value).toBe(after)
  })
  it('handles a change from absolute to explicit percentage readings without merging their identities', () => {
    const candidate = step(baseline('50'), '50%', 2000).state
    const next = step(candidate, '50.000%', 3000)
    expect(next.changed).toBe(true)
    expect(next.state.value!.key).toBe('percent:50')
  })
  it('invalidates the epoch after a backwards wall-clock adjustment', () => {
    const first = step(baseline(), '123456', 500).state
    expect(first).toMatchObject({ valid: false, lastChangedAt: null, pendingReadings: 1 })
    const recovered = step(first, '123456', 1500).state
    expect(recovered).toMatchObject({ valid: true, lastChangedAt: 1500 })
  })
  it('does not mutate the previous state', () => {
    const previous = baseline()
    const snapshot = structuredClone(previous)
    step(previous, null, 2000)
    expect(previous).toEqual(snapshot)
  })
  it('rejects nonfinite timestamps', () => {
    expect(() => step(baseline(), null, Number.NaN)).toThrow('시간')
  })
})
