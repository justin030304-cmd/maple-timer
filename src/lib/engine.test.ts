import { describe, expect, it } from 'vitest'
import { measureFrameChange } from './analysis'
import { createRuntime, formatTime, timerRuntime } from './engine'
import { normalizeROI, roiFromPoints, roiToPixels } from './roi'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from './settings'
import type { Monitor } from '../types'

const monitor: Monitor = { id: 'test', name: '테스트', kind: 'buff', enabled: true, roi: { x: 0.125, y: 0.125, width: 0.25, height: 0.25 }, durationSec: 120, warnBeforeSec: 10 }
const options = { expIdleSec: 30, hasSource: true, experimentalPixels: true }
const expMonitor: Monitor = { ...monitor, kind: 'exp' }

describe('timers and honest detection states', () => {
  it('counts actual pixel observation timestamps without accumulating interval drift', () => {
    expect(timerRuntime(expMonitor, 1000, 12500, options)).toMatchObject({ status: 'running', remainingSec: 18.5 })
  })
  it('does not issue a premature warning and expires only at the inactivity threshold', () => {
    expect(timerRuntime(expMonitor, 1000, 29000, options).status).toBe('running')
    expect(timerRuntime(expMonitor, 1000, 31000, options)).toMatchObject({ status: 'expired', remainingSec: 0 })
  })
  it('never lets disabled modules alert', () => {
    expect(timerRuntime({ ...expMonitor, enabled: false }, 1000, 999999, options).status).toBe('disabled')
  })
  it('uses the configured inactivity duration and resets on a new observation', () => {
    expect(timerRuntime(expMonitor, 1000, 32000, options).status).toBe('expired')
    expect(timerRuntime(expMonitor, 32000, 32000, options).remainingSec).toBe(30)
    expect(timerRuntime(expMonitor, 1000, 12000, { ...options, expIdleSec: 10 }).status).toBe('expired')
  })
  it('requires a shared source and a region before any timer can run', () => {
    expect(timerRuntime(expMonitor, 1000, 999999, { ...options, hasSource: false }).status).toBe('waiting')
    expect(timerRuntime({ ...expMonitor, roi: null }, 1000, 999999, options).status).toBe('unconfigured')
    expect(createRuntime(monitor).status).toBe('waiting')
  })
  it('does not treat remembered timestamps as real buff or booster detections', () => {
    for (const kind of ['buff', 'booster'] as const) {
      expect(timerRuntime({ ...monitor, kind }, 1000, 999999, options).status).toBe('no-sample')
    }
  })
  it('requires explicit opt-in for experimental experience pixel monitoring', () => {
    expect(timerRuntime(expMonitor, 1000, 32000, { ...options, experimentalPixels: false }).status).toBe('no-sample')
    expect(timerRuntime(expMonitor, 1000, 32000, options)).toMatchObject({ status: 'expired', detail: expect.stringContaining('경험치 OCR 아님') })
  })
  it('waits for an actual first frame rather than synthesizing a detection', () => {
    expect(timerRuntime(expMonitor, null, 999999, options)).toMatchObject({ status: 'waiting', lastEventAt: null })
  })
  it('surfaces frame failures without producing an alert and stops after sharing ends', () => {
    expect(timerRuntime(expMonitor, 1000, 999999, { ...options, frameError: '읽기 실패' })).toMatchObject({ status: 'error', detail: '읽기 실패' })
    expect(timerRuntime(expMonitor, 1000, 999999, { ...options, hasSource: false, frameError: '읽기 실패' }).status).toBe('waiting')
  })
  it('formats negative and nonfinite times safely', () => {
    expect(formatTime(60.2)).toBe('01:01')
    expect(formatTime(-1)).toBe('00:00')
    expect(formatTime(Number.NaN)).toBe('00:00')
  })
})

describe('live rune icon observations', () => {
  const rune: Monitor = { ...monitor, kind: 'rune' }

  it('waits for a first frame rather than inventing a detection or countdown', () => {
    expect(timerRuntime(rune, 1000, 999999, options)).toMatchObject({ status: 'waiting', remainingSec: 0 })
  })
  it('watches real frames when no rune candidate is present', () => {
    expect(timerRuntime(rune, null, 5000, { ...options, rune: { present: false, score: 0.2 } })).toMatchObject({ status: 'watching', remainingSec: 0 })
  })
  it('reports an observed candidate without implying activation or a cooldown', () => {
    const runtime = timerRuntime(rune, 5000, 500000, { ...options, rune: { present: true, score: 0.86 } })
    expect(runtime).toMatchObject({ status: 'detected', remainingSec: 0, lastEventAt: 5000 })
    expect(runtime.detail).toContain('색상·모양 기반 실험')
  })
  it('stops observations when disabled, sharing ends, or its region is removed', () => {
    const detected = { ...options, rune: { present: true, score: 0.9 } }
    expect(timerRuntime({ ...rune, enabled: false }, 5000, 5000, detected).status).toBe('disabled')
    expect(timerRuntime(rune, 5000, 5000, { ...detected, hasSource: false }).status).toBe('waiting')
    expect(timerRuntime({ ...rune, roi: null }, 5000, 5000, detected).status).toBe('unconfigured')
  })
  it('surfaces analysis failures instead of keeping a stale detected status', () => {
    expect(timerRuntime(rune, 5000, 5000, { ...options, rune: { present: true, score: null, frameError: '미니맵 프레임 읽기 실패' } })).toMatchObject({ status: 'error', detail: '미니맵 프레임 읽기 실패' })
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
  it('migrates existing version-one preferences without resetting monitors or regions', () => {
    const previous = { volume: 0.2, soundEnabled: false, expIdleSec: 45, monitors: [{ ...monitor, id: 'custom-buff' }, ...DEFAULT_SETTINGS.monitors.filter(item => item.kind !== 'buff')] }
    const storage = memoryStorage(JSON.stringify({ version: 1, settings: previous }))
    const loaded = loadSettings(storage)
    expect(loaded).toMatchObject({ ...previous, voiceURI: '', speechRate: 1, notificationSound: 'speech', runeDetection: { minSize: 5, maxSize: 36, minScore: 0.7 } })
    expect(loaded.monitors[0].roi).toEqual(monitor.roi)
  })
  it('preserves the selected speech voice and bounds invalid speech preferences', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, settings: { voiceURI: 'Microsoft SunHi Korean', speechRate: 9, notificationSound: 'invalid', monitors: DEFAULT_SETTINGS.monitors } }))
    const loaded = loadSettings(storage)
    expect(loaded).toMatchObject({ voiceURI: 'Microsoft SunHi Korean', speechRate: 1.3, notificationSound: 'speech' })
  })
  it('roundtrips customized rune detector thresholds', () => {
    const storage = memoryStorage()
    const settings = { ...DEFAULT_SETTINGS, runeDetection: { minSize: 9, maxSize: 48, minScore: 0.82 } }
    expect(saveSettings(settings, storage)).toBe(true)
    expect(loadSettings(storage).runeDetection).toEqual(settings.runeDetection)
  })
  it('bounds rune sizes and scores and preserves minimum-to-maximum ordering', () => {
    const read = (runeDetection: unknown) => loadSettings(memoryStorage(JSON.stringify({ version: 1, settings: { runeDetection } }))).runeDetection
    expect(read({ minSize: 999, maxSize: 1, minScore: 2 })).toEqual({ minSize: 64, maxSize: 64, minScore: 0.95 })
    expect(read({ minSize: -1, maxSize: 999, minScore: -1 })).toEqual({ minSize: 3, maxSize: 128, minScore: 0.4 })
    expect(read({ minSize: 64 })).toEqual({ minSize: 64, maxSize: 64, minScore: 0.7 })
    expect(read('invalid')).toEqual(DEFAULT_SETTINGS.runeDetection)
  })
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
    loaded.runeDetection.minSize = 60
    expect(loadSettings(null).monitors[0].enabled).toBe(true)
    expect(loadSettings(null).runeDetection.minSize).toBe(5)
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
