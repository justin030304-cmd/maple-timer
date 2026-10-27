import type { Monitor, MonitorRuntime } from '../types'

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function createRuntime(monitor: Monitor): MonitorRuntime {
  return timerRuntime(monitor, null, Date.now(), { expIdleSec: 60, hasSource: false })
}

export interface TimerOptions {
  expIdleSec: number
  hasSource?: boolean
  frameError?: string | null
  experimentalPixels?: boolean
  rune?: { present: boolean; score: number | null; frameError?: string | null }
}

/** Rune candidate observations and opt-in pixel inactivity never imply game activation. */
export function timerRuntime(monitor: Monitor, lastEventAt: number | null, nowMs: number, options: TimerOptions): MonitorRuntime {
  const base = { remainingSec: monitor.kind === 'rune' ? 0 : monitor.kind === 'exp' ? options.expIdleSec : monitor.durationSec, lastEventAt }
  if (!monitor.enabled) return { ...base, status: 'disabled', detail: '모듈이 꺼져 있습니다' }
  if (!options.hasSource) return { ...base, status: 'waiting', detail: '화면 공유를 시작해 주세요' }
  if (!monitor.roi) return { ...base, status: 'unconfigured', detail: '화면에서 인식 영역을 지정해 주세요' }
  if (monitor.kind === 'rune') {
    if (options.rune?.frameError) return { ...base, status: 'error', detail: options.rune.frameError }
    if (!options.rune) return { ...base, status: 'waiting', detail: '미니맵 분석 · 첫 프레임 대기 중' }
    return options.rune.present
      ? { ...base, status: 'detected', detail: '룬 후보 아이콘 감지 · 색상·모양 기반 실험' }
      : { ...base, status: 'watching', detail: '미니맵 마름모 아이콘 감시 중 · 실험' }
  }
  if (monitor.kind !== 'exp' || !options.experimentalPixels) return { ...base, status: 'no-sample', detail: '실제 인식용 샘플이 없습니다 · 자동 감지 준비 중' }
  if (options.frameError) return { ...base, status: 'error', detail: options.frameError }
  if (lastEventAt === null) return { ...base, status: 'waiting', detail: '픽셀 변화 · 실험 · 첫 프레임 대기 중' }

  const elapsed = Math.max(0, (nowMs - lastEventAt) / 1000)
  const remainingSec = Math.max(0, base.remainingSec - elapsed)
  const status = remainingSec <= 0 ? 'expired' : 'running'
  const detail = status === 'expired'
    ? '픽셀 변화 없음 · 실험 경고 · 경험치 OCR 아님'
    : '마지막 픽셀 변화 이후 · 실험 · 경험치 OCR 아님'
  return { remainingSec, lastEventAt, status, detail }
}
