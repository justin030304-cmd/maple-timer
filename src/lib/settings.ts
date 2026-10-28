import { readMonitorAudio } from './monitorAudio'
import type { ModuleKind, Monitor, RuneDetectorSettings, Settings } from '../types'
import { normalizeROI } from './roi'

export const SETTINGS_KEY = 'maple-timer.settings.v1'
export const DEFAULT_SETTINGS: Settings = {
  volume: 1,
  soundEnabled: true,
  notificationSound: 'speech',
  voiceURI: '',
  speechRate: 1,
  expDetectionMode: 'visual',
  expIdleSec: 60,
  runeDetection: { minSize: 5, maxSize: 36, minScore: 0.7 },
  monitors: [
    { id: 'rune', name: '룬', kind: 'rune', enabled: true, roi: null, durationSec: 900, warnBeforeSec: 30 },
    { id: 'exp', name: '경험치 변화', kind: 'exp', enabled: true, roi: null, durationSec: 60, warnBeforeSec: 10 },
    { id: 'countdown', name: '부스터', kind: 'countdown', enabled: true, roi: null, durationSec: 999, warnBeforeSec: 10 },
  ],
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const cloneDefaults = (): Settings => ({ ...DEFAULT_SETTINGS, runeDetection: { ...DEFAULT_SETTINGS.runeDetection }, monitors: DEFAULT_SETTINGS.monitors.map(monitor => ({ ...monitor })) })
const kinds: ModuleKind[] = ['rune', 'buff', 'exp', 'booster', 'countdown']
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

function readRuneDetection(value: unknown): RuneDetectorSettings {
  const saved = isRecord(value) ? value : {}
  const defaults = DEFAULT_SETTINGS.runeDetection
  const minSize = Math.round(bounded(saved.minSize, defaults.minSize, 3, 64))
  return {
    minSize,
    maxSize: Math.round(bounded(saved.maxSize, Math.max(minSize, defaults.maxSize), minSize, 128)),
    minScore: bounded(saved.minScore, defaults.minScore, 0.4, 0.95),
  }
}

function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function readMonitor(value: unknown): Monitor | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || typeof value.name !== 'string' || !kinds.includes(value.kind as ModuleKind)) return null
  const durationSec = Math.round(bounded(value.durationSec, 300, 1, 86400))
  const roi = isRecord(value.roi) ? normalizeROI({ x: Number(value.roi.x), y: Number(value.roi.y), width: Number(value.roi.width), height: Number(value.roi.height) }) : null
  return {
    id: value.id, name: value.name.trim().slice(0, 60) || '이름 없는 모듈', kind: value.kind as ModuleKind,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    ...(value.kind === 'buff' && (value.buffTarget === 'potion' || value.buffTarget === 'union-wealth') ? {buffTarget:value.buffTarget} : {}),
    ...(value.audio !== undefined ? { audio: readMonitorAudio(value.audio, value.kind as ModuleKind) } : {}),
    roi, durationSec, warnBeforeSec: Math.round(bounded(value.warnBeforeSec, 30, 0, durationSec)),
  }
}

/** Invalid, old, blocked or corrupt storage always falls back to usable settings. */
export function loadSettings(storage: StorageLike | null = browserStorage()): Settings {
  const defaults = cloneDefaults()
  try {
    const raw: unknown = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null')
    if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.settings)) return defaults
    const saved = raw.settings
    const seen = new Set<string>()
    const monitors = Array.isArray(saved.monitors) ? saved.monitors.slice(0, 50).map(readMonitor).filter((monitor): monitor is Monitor => {
      if (!monitor || monitor.kind === 'booster' || (monitor.kind === 'buff' && !monitor.buffTarget) || seen.has(monitor.id)) return false
      seen.add(monitor.id)
      return true
    }) : defaults.monitors
    // Retain the working countdown monitor's ROI, audio and threshold; only its label changes.
    for (const monitor of monitors) if (monitor.kind === 'countdown') monitor.name = '부스터'
    // Core modules remain available even if old or manually edited storage omits them.
    for (const core of defaults.monitors.filter(monitor => monitor.kind !== 'buff')) {
      if (!monitors.some(monitor => monitor.kind === core.kind)) monitors.push(core)
    }
    return {
      // Apply the louder master level once; preserve explicit zero/mute and
      // every volume the user chooses after this update.
      volume: raw.audioVolumeVersion === 1 || saved.volume === 0 ? bounded(saved.volume, defaults.volume, 0, 1) : 1,
      soundEnabled: typeof saved.soundEnabled === 'boolean' ? saved.soundEnabled : defaults.soundEnabled,
      notificationSound: saved.notificationSound === 'chime' ? 'chime' : 'speech',
      voiceURI: typeof saved.voiceURI === 'string' ? saved.voiceURI.slice(0, 512) : defaults.voiceURI,
      speechRate: bounded(saved.speechRate, defaults.speechRate, 0.7, 1.3),
      expDetectionMode: saved.expDetectionMode === 'ocr' ? 'ocr' : 'visual',
      expIdleSec: Math.round(bounded(saved.expIdleSec, defaults.expIdleSec, 5, 3600)),
      runeDetection: readRuneDetection(saved.runeDetection),
      monitors,
    }
  } catch { return defaults }
}

/** Returns false when browser privacy settings or storage limits prevent persistence. */
export function saveSettings(settings: Settings, storage: StorageLike | null = browserStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, audioVolumeVersion: 1, settings }))
    return true
  } catch { return false }
}
