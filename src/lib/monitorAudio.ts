import type { ModuleKind, Monitor, MonitorAudio, Settings } from '../types'

export function defaultMonitorAudio(kind: ModuleKind): MonitorAudio {
  return { sound: kind === 'rune' ? 'speech' : kind === 'exp' ? 'dingdong' : 'inherit', volume: 1, voiceURI: '', speechText: kind === 'rune' ? '룬 떳어요' : '' }
}
export function readMonitorAudio(value: unknown, kind: ModuleKind): MonitorAudio {
  const defaults = defaultMonitorAudio(kind)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const saved = value as Record<string, unknown>
  return {
    sound: ['inherit', 'speech', 'dingdong', 'chime', 'silent'].includes(String(saved.sound)) ? saved.sound as MonitorAudio['sound'] : defaults.sound,
    volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 1,
    voiceURI: typeof saved.voiceURI === 'string' ? saved.voiceURI.slice(0, 512) : '',
    speechText: typeof saved.speechText === 'string' ? saved.speechText.slice(0, 200) : defaults.speechText,
  }
}
export function resolveMonitorAudio(settings: Settings, message: string, monitor?: Monitor) {
  const audio = monitor ? readMonitorAudio(monitor.audio, monitor.kind) : null
  const inherited = !audio || audio.sound === 'inherit'
  return {
    sound: inherited ? settings.notificationSound : audio.sound,
    volume: settings.volume * (audio?.volume ?? 1),
    voiceURI: inherited ? settings.voiceURI : audio.voiceURI,
    text: inherited ? message : audio.speechText.trim() || message,
  }
}
