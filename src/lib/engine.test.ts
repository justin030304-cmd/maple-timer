import { describe, expect, it } from 'vitest'
import { measureFrameChange } from './analysis'
import { createRuntime, formatTime, timerRuntime } from './engine'
import { normalizeROI, roiFromPoints, roiToPixels } from './roi'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from './settings'
import type { Monitor } from '../types'

const monitor: Monitor = { id: 'test', name: '테스트', kind: 'buff', enabled: true, roi: { x: 0.125, y: 0.125, width: 0.25, height: 0.25 }, durationSec: 120, warnBeforeSec: 10 }
const options = { mode: 'demo' as const, expIdleSec: 30 }

describe('timers and honest detection states', () => {
  it('counts from an event timestamp, without accumulating interval drift', () => {
    expect(timerRuntime(monitor, 1000, 62500, options)).toMatchObject({ status: 'running', remainingSec: 58.5 })
  })
  it('warns before expiry and expires at zero', () => {
    expect(timerRuntime(monitor, 1000, 111000, options).status).toBe('warning')
    expect(timerRuntime(monitor, 1000, 122000, options)).toMatchObject({ status: 'expired', remainingSec: 0 })
  })
  it('never lets disabled modules alert', () => {
    expect(timerRuntime({ ...monitor, enabled: false }, 1000, 999999, options).status).toBe('disabled')
  })
  it('uses the experience inactivity setting and resets on a new event', () => {
    const exp = { ...monitor, kind: 'exp' as const }
    expect(timerRuntime(exp, 1000, 29000, options).status).toBe('running')
    expect(timerRuntime(exp, 1000, 32000, options).status).toBe('expired')
    expect(timerRuntime(exp, 32000, 32000, options).remainingSec).toBe(30)
  })
  it('requires a source and a region in live mode', () => {
    expect(timerRuntime(monitor, null, 0, { ...options, mode: 'live' }).status).toBe('waiting')
    expect(timerRuntime({ ...monitor, roi: null }, null, 0, { ...options, mode: 'live', hasSource: true }).status).toBe('unconfigured')
  })
  it('does not pretend to recognize real icons', () => {
    expect(timerRuntime(monitor, 1000, 999999, { ...options, mode: 'live', hasSource: true }).status).toBe('no-sample')
  })
  it('requires explicit opt-in for experimental experience pixel monitoring', () => {
    const exp = { ...monitor, kind: 'exp' as const }
    const live = { ...options, mode: 'live' as const, hasSource: true }
    expect(timerRuntime(exp, 1000, 32000, live).status).toBe('no-sample')
    expect(timerRuntime(exp, 1000, 32000, { ...live, experimentalPixels: true })).toMatchObject({ status: 'expired', detail: expect.stringContaining('경험치 OCR 아님') })
    expect(timerRuntime(monitor, 1000, 999999, { ...live, experimentalPixels: true }).status).toBe('no-sample')
  })
  it('surfaces frame failures and empty event state', () => {
    expect(timerRuntime(monitor, null, 0, { ...options, frameError: '읽기 실패' })).toMatchObject({ status: 'error', detail: '읽기 실패' })
    expect(createRuntime(monitor).status).toBe('waiting')
  })
  it('formats negative and nonfinite times safely', () => {
    expect(formatTime(60.2)).toBe('01:01')
    expect(formatTime(-1)).toBe('00:00')
    expect(formatTime(Number.NaN)).toBe('00:00')
  })
})

describe('ROI coordinates', () => {
  it('supports dragging in either direction', () => {
    const roi = roiFromPoints({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 })!
    expect(roi.x).toBeCloseTo(0.2)
    expect(roi.width).toBeCloseTo(0.6)
    expect(roi.height).toBeCloseTo(0.6)
  })
  it('clips selections to the source image', () => {
    expect(normalizeROI({ x: -1, y: -1, width: 3, height: 3 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
  it('rejects clicks, tiny selections, and invalid numbers', () => {
    expect(roiFromPoints({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 })).toBeNull()
    expect(normalizeROI({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull()
  })
  it('maps normalized regions into source pixels, not preview pixels', () => {
    expect(roiToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 1920, 1080)).toEqual({ x: 480, y: 540, width: 960, height: 270 })
  })
})

function memoryStorage(initial = '') {
  let value = initial
  return { getItem: (_key: string) => value, setItem: (_key: string, next: string) => { value = next } }
}

describe('persistent settings', () => {
  it('roundtrips settings and custom buffs', () => {
    const storage = memoryStorage()
    const settings = { ...DEFAULT_SETTINGS, volume: 0.3, monitors: [...DEFAULT_SETTINGS.monitors, { ...monitor, id: 'custom-buff' }] }
    expect(saveSettings(settings, storage)).toBe(true)
    expect(loadSettings(storage)).toEqual(settings)
  })
  it('recovers from corrupted and version-mismatched storage', () => {
    expect(loadSettings(memoryStorage('{'))).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(memoryStorage(JSON.stringify({ version: 2, settings: {} })))).toEqual(DEFAULT_SETTINGS)
  })
  it('survives unavailable localStorage', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
    expect(saveSettings(DEFAULT_SETTINGS, storage)).toBe(false)
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false)
  })
  it('clamps out-of-range numbers and keeps core modules available', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, settings: { volume: 10, expIdleSec: -1, monitors: [] } }))
    const loaded = loadSettings(storage)
    expect(loaded.volume).toBe(1)
    expect(loaded.expIdleSec).toBe(5)
    expect(loaded.monitors.map(item => item.kind)).toEqual(['rune', 'exp', 'booster'])
  })
  it('rejects malformed monitors and duplicate IDs', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, settings: { monitors: [null, { id: 'broken' }, monitor, monitor] } }))
    expect(loadSettings(storage).monitors.filter(item => item.id === 'test')).toHaveLength(1)
  })
  it('uses independent defaults between loads', () => {
    const loaded = loadSettings(null)
    loaded.monitors[0].enabled = false
    expect(loadSettings(null).monitors[0].enabled).toBe(true)
    expect(SETTINGS_KEY).toContain('.v1')
  })
})

describe('local pixel-change measurement', () => {
  const frame = (value: number) => ({ width: 1, height: 1, data: new Uint8ClampedArray([value, value, value, 255]) })
  it('does not invent a change without a matching baseline', () => {
    expect(measureFrameChange(null, frame(0))).toBeNull()
    expect(measureFrameChange({ width: 2, height: 1, data: new Uint8ClampedArray(8) }, frame(0))).toBeNull()
  })
  it('measures identical and maximally different frames', () => {
    expect(measureFrameChange(frame(20), frame(20))).toBe(0)
    expect(measureFrameChange(frame(0), frame(255))).toBe(1)
  })
  it('rejects malformed frame buffers', () => {
    expect(() => measureFrameChange(null, { width: 2, height: 2, data: new Uint8ClampedArray(1) })).toThrow()
  })
})
