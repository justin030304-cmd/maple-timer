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
}

/** Count only actual, explicitly enabled pixel observations; semantic detectors need samples. */
export function timerRuntime(monitor: Monitor, lastEventAt: number | null, nowMs: number, options: TimerOptions): MonitorRuntime {
  const base = { remainingSec: monitor.kind === 'exp' ? options.expIdleSec : monitor.durationSec, lastEventAt }
  if (!monitor.enabled) return { ...base, status: 'disabled', detail: '모듈이 꺼져 있습니다' }
  if (!options.hasSource) return { ...base, status: 'waiting', detail: '화면 공유를 시작해 주세요' }
  if (!monitor.roi) return { ...base, status: 'unconfigured', detail: '화면에서 인식 영역을 지정해 주세요' }
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
