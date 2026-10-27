export type ModuleKind = 'rune' | 'buff' | 'exp' | 'booster'

/** Coordinates are fractions of the original shared image, never CSS pixels. */
export interface ROI {
  x: number
  y: number
  width: number
  height: number
}

export interface Monitor {
  id: string
  name: string
  kind: ModuleKind
  enabled: boolean
  roi: ROI | null
  durationSec: number
  warnBeforeSec: number
}

export interface RuneDetectorSettings {
  minSize: number
  maxSize: number
  minScore: number
}

export interface Settings {
  volume: number
  soundEnabled: boolean
  notificationSound: 'speech' | 'chime'
  voiceURI: string
  speechRate: number
  expIdleSec: number
  runeDetection: RuneDetectorSettings
  monitors: Monitor[]
}

export interface MonitorRuntime {
  remainingSec: number
  status: 'waiting' | 'running' | 'warning' | 'expired' | 'disabled' | 'unconfigured' | 'no-sample' | 'watching' | 'detected' | 'error'
  lastEventAt: number | null
  detail: string
}
