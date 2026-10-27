import type { Mode, Monitor, MonitorRuntime } from '../types'

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function createRuntime(monitor: Monitor, mode: Mode = 'demo'): MonitorRuntime {
  return timerRuntime(monitor, null, Date.now(), { mode, expIdleSec: 60, hasSource: false })
}

export interface TimerOptions {
  mode: Mode
  expIdleSec: number
  hasSource?: boolean
  frameError?: string | null
  experimentalPixels?: boolean
}

/** Only demo events drive semantic timers until sample-backed detectors exist. */
export function timerRuntime(monitor: Monitor, lastEventAt: number | null, nowMs: number, options: TimerOptions): MonitorRuntime {
  const base = { remainingSec: monitor.kind === 'exp' ? options.expIdleSec : monitor.durationSec, lastEventAt }
  if (!monitor.enabled) return { ...base, status: 'disabled', detail: '모듈이 꺼져 있습니다' }
  if (options.frameError) return { ...base, status: 'error', detail: options.frameError }
  if (options.mode === 'live') {
    if (!options.hasSource) return { ...base, status: 'waiting', detail: '화면 공유를 시작해 주세요' }
    if (!monitor.roi) return { ...base, status: 'unconfigured', detail: '화면에서 인식 영역을 지정해 주세요' }
    if (monitor.kind !== 'exp' || !options.experimentalPixels) return { ...base, status: 'no-sample', detail: '실제 인식용 샘플이 없습니다 · 자동 감지 준비 중' }
  }
  if (lastEventAt === null) return { ...base, status: 'waiting', detail: options.mode === 'live' ? '픽셀 변화 · 실험 · 첫 프레임 대기 중' : '데모 이벤트를 기다리고 있습니다' }
  const elapsed = Math.max(0, (nowMs - lastEventAt) / 1000)
  const remainingSec = Math.max(0, base.remainingSec - elapsed)
  const status = remainingSec <= 0 ? 'expired' : monitor.kind !== 'exp' && remainingSec <= Math.min(monitor.warnBeforeSec, base.remainingSec) ? 'warning' : 'running'
  const detail = options.mode === 'live'
    ? status === 'expired' ? '픽셀 변화 없음 · 실험 경고 · 경험치 OCR 아님' : '마지막 픽셀 변화 이후 · 실험 · 경험치 OCR 아님'
    : monitor.kind === 'exp'
    ? status === 'expired' ? '경험치 변화 없음 · 데모 경고' : '마지막 경험치 변화 이후 · 데모'
    : status === 'expired' ? '시간 종료 · 데모' : status === 'warning' ? '종료가 가까워졌습니다 · 데모' : '가상 이벤트 기준 타이머 · 데모'
  return { remainingSec, lastEventAt, status, detail }
}
