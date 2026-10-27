import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Check, Hand, Maximize, MousePointer2, Minus, Plus, X } from 'lucide-react'
import type { Monitor, ROI } from '../types'
import { normalizeROI } from '../lib/roi'
import { locateExperienceRegion } from '../lib/experienceVisual'
import './RegionSelector.css'

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n))
type Drag = { pointer: number; kind: 'draw' | 'pan' | 'move' | 'resize'; x: number; y: number; clientX: number; clientY: number; pan: { x: number; y: number }; original: ROI | null; anchor?: { x: number; y: number } }

export default function RegionSelector({ stream, monitor, onApply, onClose }: {
  stream: MediaStream; monitor: Monitor; onApply: (roi: ROI) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), image = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), preview = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState({ width: 1280, height: 720 })
  const [bounds, setBounds] = useState({ width: 1000, height: 480 })
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 })
  const [mode, setMode] = useState<'draw' | 'pan' | 'bar'>(monitor.kind === 'exp' ? 'bar' : 'draw')
  const [draft, setDraft] = useState<ROI | null>(monitor.roi)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const latest = useRef({ draft, onClose }); latest.current = { draft, onClose }
  const fit = Math.min(bounds.width / size.width, bounds.height / size.height)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (latest.current.draft) setDraft(null); else latest.current.onClose() }
      if (event.key !== 'Tab') return
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]')
      if (!items?.length) return
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = stream
    void element.play().catch(() => setError('공유 영상을 재생하지 못했습니다. 다시 공유해 주세요.'))
    return () => { element.srcObject = null }
  }, [stream])
  useEffect(() => {
    const draw = () => {
      const canvas = preview.current, source = video.current
      if (!canvas || !source || !draft || source.readyState < 2) return
      const ratio = Math.min(1, 900 / (draft.width * source.videoWidth), 180 / (draft.height * source.videoHeight))
      canvas.width = Math.max(1, Math.round(draft.width * source.videoWidth * ratio))
      canvas.height = Math.max(1, Math.round(draft.height * source.videoHeight * ratio))
      canvas.getContext('2d')?.drawImage(source, draft.x * source.videoWidth, draft.y * source.videoHeight, draft.width * source.videoWidth, draft.height * source.videoHeight, 0, 0, canvas.width, canvas.height)
    }
    draw(); const timer = window.setInterval(draw, 500)
    return () => clearInterval(timer)
  }, [draft, ready])
  const point = (event: ReactPointerEvent) => {
    const rect = image.current!.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const changeZoom = (next: number, clientX?: number, clientY?: number) => {
    next = clamp(next, 1, 6)
    const rect = viewport.current!.getBoundingClientRect()
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2
    const ratio = next / zoom
    setPan(current => ({ x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio })); setZoom(next)
  }
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => { event.preventDefault(); changeZoom(zoom * (event.deltaY > 0 ? .9 : 1.1), event.clientX, event.clientY) }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  })
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event), rect = image.current!.getBoundingClientRect()
    if (mode !== 'pan' && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) return
    const corner = (event.target as HTMLElement).closest<HTMLElement>('[data-corner]')?.dataset.corner
    const inside = draft && p.x >= draft.x && p.x <= draft.x + draft.width && p.y >= draft.y && p.y <= draft.y + draft.height
    let kind: Drag['kind'] = mode === 'pan' ? inside ? 'move' : 'pan' : 'draw'
    let anchor: Drag['anchor']
    if (corner && draft) { kind = 'resize'; anchor = { x: corner.includes('l') ? draft.x + draft.width : draft.x, y: corner.includes('t') ? draft.y + draft.height : draft.y } }
    if (mode === 'bar' && !corner) {
      const source = video.current!, canvas = document.createElement('canvas')
      canvas.width = source.videoWidth; canvas.height = source.videoHeight
      const context = canvas.getContext('2d')!
      try {
        context.drawImage(source, 0, 0)
        const found = locateExperienceRegion(context.getImageData(0, 0, canvas.width, canvas.height), p.y)
        if (found) { setDraft(found); setError('') }
        else setError('이 위치에서 경험치 숫자를 찾지 못했습니다. 바 윗선을 다시 클릭하거나 직접 그리기를 사용해 주세요.')
      } catch { setError('공유 화면을 읽지 못했습니다. 화면 공유 상태를 확인해 주세요.') }
      return
    }
    drag.current = { pointer: event.pointerId, kind, ...p, clientX: event.clientX, clientY: event.clientY, pan, original: draft, anchor }
    if (kind === 'draw') setDraft({ x: p.x, y: p.y, width: 0, height: 0 })
    setError('')
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    if (current.kind === 'pan') { setPan({ x: current.pan.x + event.clientX - current.clientX, y: current.pan.y + event.clientY - current.clientY }); return }
    const p = point(event)
    if (current.kind === 'move' && current.original) {
      const original = current.original
      setDraft({ ...original, x: clamp(original.x + p.x - current.x, 0, 1 - original.width), y: clamp(original.y + p.y - current.y, 0, 1 - original.height) })
    } else {
      const anchor = current.anchor ?? current
      let target = p
      if (current.kind === 'resize' && current.original && current.anchor) {
        const original = current.original
        target = { x: clamp(original.x + (anchor.x === original.x ? original.width : 0) + p.x - current.x), y: clamp(original.y + (anchor.y === original.y ? original.height : 0) + p.y - current.y) }
      }
      setDraft({ x: Math.min(anchor.x, target.x), y: Math.min(anchor.y, target.y), width: Math.abs(anchor.x - target.x), height: Math.abs(anchor.y - target.y) })
    }
  }
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => { move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }
  const title = monitor.kind === 'rune' ? '미니맵 영역 선택' : monitor.kind === 'exp' ? '경험치 바 영역 선택' : `${monitor.name} 영역 선택`
  const valid = draft ? normalizeROI(draft) : null
  return <div className="region-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} className="region-dialog" role="dialog" aria-modal="true" aria-labelledby="region-title" tabIndex={-1}>
      <header className="region-heading"><div><span>인식 영역 설정</span><h2 id="region-title">{title}</h2><p>{monitor.kind === 'exp' ? '경험치 바 윗선을 클릭하거나 숫자 한 줄을 직접 그려 주세요.' : monitor.kind === 'rune' ? '아이콘이 표시되는 미니맵 내부 지도를 드래그해 주세요.' : '감시할 화면 영역을 드래그해 주세요.'}</p></div><button className="icon-button" aria-label="영역 선택 창 닫기" onClick={onClose}><X /></button></header>
      <div className="region-tools">
        <div className="region-tool-group"><button aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}><Hand size={16} />이동</button><button aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}><MousePointer2 size={16} />{monitor.kind === 'exp' ? '직접 그리기' : '영역 선택'}</button>{monitor.kind === 'exp' && <button aria-pressed={mode === 'bar'} onClick={() => setMode('bar')}>바 윗선 클릭</button>}</div>
        <div className="region-tool-group"><button aria-label="축소" disabled={zoom <= 1} onClick={() => changeZoom(zoom / 1.25)}><Minus size={17} /></button><output aria-label="확대 배율">{Math.round(zoom * 100)}%</output><button aria-label="확대" disabled={zoom >= 6} onClick={() => changeZoom(zoom * 1.25)}><Plus size={17} /></button><button onClick={reset}><Maximize size={16} />화면 맞춤</button></div>
      </div>
      <div className="region-help">드래그: 선택 · 이동 모드: 화면/상자 조정 · 휠: 확대·축소 · Esc: 선택 지우기</div>
      <div className={`region-viewport region-mode-${mode}`} ref={viewport} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null }}>
        <div className="region-image" ref={image} data-testid="region-image" style={{ width: size.width * fit * zoom, height: size.height * fit * zoom, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)` }}>
          <video ref={video} muted autoPlay playsInline onLoadedMetadata={() => { const source = video.current!; setSize({ width: source.videoWidth, height: source.videoHeight }); setReady(true) }} onResize={() => { const source = video.current!; if (source.videoWidth) { setSize({ width: source.videoWidth, height: source.videoHeight }); reset() } }} />
          {draft && <div className="region-selection" data-testid="region-selection" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }}><span>{Math.round(draft.width * size.width)} × {Math.round(draft.height * size.height)} px</span>{['tl','tr','bl','br'].map(corner => <i key={corner} data-corner={corner} className={`region-handle ${corner}`} />)}</div>}
        </div>
      </div>
      <div className="region-summary"><div><strong>선택 영역 미리보기</strong><p>공유 해상도 {size.width} × {size.height} · {valid ? '적용을 누르면 감시 영역으로 저장됩니다.' : '화면에서 인식할 영역을 선택해 주세요.'}</p>{error && <p role="alert" className="region-error">{error}</p>}</div>{valid && <canvas ref={preview} aria-label="선택 영역 미리보기" />}</div>
      <div className="region-coordinates">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{{x:'X',y:'Y',width:'너비',height:'높이'}[key]} (%)<input aria-label={`선택 ${key} (%)`} type="number" min={0} max={100} step={.1} value={Number(((draft?.[key] ?? 0) * 100).toFixed(2))} onChange={event => { const next = { ...(draft ?? {x:0,y:0,width:.2,height:.2}), [key]: clamp(Number(event.target.value) / 100) }; setDraft({ ...next, width: Math.min(next.width, 1 - next.x), height: Math.min(next.height, 1 - next.y) }) }} /></label>)}</div>
      <footer className="region-actions"><button className="text-button" disabled={!draft} onClick={() => setDraft(null)}>선택 지우기</button><span>영상은 브라우저에서만 처리합니다</span><button className="button" onClick={onClose}>취소</button><button className="button primary" disabled={!valid || !ready} onClick={() => { if (valid) onApply(valid) }}><Check size={17} />적용</button></footer>
    </div>
  </div>
}
