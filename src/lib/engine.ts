import type { Monitor, MonitorRuntime } from '../types'

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function createRuntime(monitor: Monitor): MonitorRuntime {
  return timerRuntime(monitor, null, Date.now(), { expIdleSec: 60, hasSource: false })
}

export interface ExpObservation {
  value: string | null
  lastChangedAt: number | null
  lastReadAt: number | null
  valid: boolean
  error?: string | null
  loading?: boolean
  confirming?: boolean
}

export interface TimerOptions {
  expIdleSec: number
  hasSource?: boolean
  exp?: ExpObservation
  rune?: { present: boolean; score: number | null; frameError?: string | null }
}

/** Only fresh, confirmed numeric OCR observations can drive the experience timer. */
export function timerRuntime(monitor: Monitor, lastEventAt: number | null, nowMs: number, options: TimerOptions): MonitorRuntime {
  const base = {
    remainingSec: monitor.kind === 'rune' ? 0 : monitor.kind === 'exp' ? options.expIdleSec : monitor.durationSec,
    lastEventAt: monitor.kind === 'exp' ? options.exp?.lastChangedAt ?? null : lastEventAt,
  }
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
  if (monitor.kind !== 'exp') return { ...base, status: 'no-sample', detail: '실제 인식용 샘플이 없습니다 · 자동 감지 준비 중' }

  const exp = options.exp
  if (!exp || exp.loading) return {
    ...base,
    status: 'waiting',
    detail: exp?.loading ? '경험치 숫자 인식 모델 준비 중' : '경험치 숫자 인식 · 첫 값 대기 중',
  }
  if (exp.error) return { ...base, status: 'error', detail: exp.error }
  if (exp.confirming) return { ...base, status: 'waiting', detail: '경험치 숫자 연속 확인 중' }
  if (!exp.valid || !exp.value?.trim()) return { ...base, status: 'error', detail: '경험치 숫자를 읽지 못했습니다. 초록색 경험치 바의 숫자 부분으로 인식 영역을 조정해 주세요.' }
  if (exp.lastReadAt === null || !Number.isFinite(exp.lastReadAt) || nowMs - exp.lastReadAt > 4000) return {
    ...base,
    status: 'error',
    detail: '경험치 숫자 인식이 지연되었습니다. 화면 공유와 인식 영역을 확인해 주세요.',
  }
  if (exp.lastChangedAt === null || !Number.isFinite(exp.lastChangedAt)) return { ...base, status: 'waiting', detail: '경험치 숫자 인식 · 연속 확인 대기 중' }

  const elapsed = Math.max(0, (nowMs - exp.lastChangedAt) / 1000)
  const remainingSec = Math.max(0, base.remainingSec - elapsed)
  const status = remainingSec <= 0 ? 'expired' : 'running'
  const detail = status === 'expired'
    ? '경험치 숫자 변화 없음 · 설정 시간 경과'
    : '경험치 숫자 변화 감시 중'
  return { remainingSec, lastEventAt: exp.lastChangedAt, status, detail }
}
