export type ModuleKind = 'rune' | 'buff' | 'exp' | 'booster'
export type Mode = 'demo' | 'live'

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

export interface Settings {
  volume: number
  soundEnabled: boolean
  expIdleSec: number
  monitors: Monitor[]
}

export interface MonitorRuntime {
  remainingSec: number
  status: 'waiting' | 'running' | 'warning' | 'expired' | 'disabled' | 'unconfigured' | 'no-sample' | 'error'
  lastEventAt: number | null
  detail: string
}
