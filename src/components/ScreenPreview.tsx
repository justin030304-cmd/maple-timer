import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Monitor, ROI } from '../types'
import { DemoScene } from './DemoScene'
import './ScreenPreview.css'

export interface ScreenPreviewProps {
  mode: 'demo' | 'live'
  stream: MediaStream | null
  monitors: Monitor[]
  editingId: string | null
  onSelectMonitor: (id: string | null) => void
  onRoiChange: (id: string, roi: ROI) => void
  onVideoReady?: (video: HTMLVideoElement | null) => void
  demoRunning: boolean
}

type DragState = {
  id: string
  pointerId: number
  kind: 'draw' | 'move'
  startX: number
  startY: number
  original: ROI | null
}

const colorByKind = { rune: '#ad9aeb', buff: '#d4af72', exp: '#9ac8aa', booster: '#9dbbce' }
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))

export function ScreenPreview({ mode, stream, monitors, editingId, onSelectMonitor, onRoiChange, onVideoReady, demoRunning }: ScreenPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const onVideoReadyRef = useRef(onVideoReady)
  const dragRef = useRef<DragState | null>(null)
  const [draft, setDraft] = useState<ROI | null>(null)
  const [aspectRatio, setAspectRatio] = useState(16 / 9)
  const [videoError, setVideoError] = useState(false)
  const selected = monitors.find(monitor => monitor.id === editingId)
  onVideoReadyRef.current = onVideoReady

  useEffect(() => {
    const video = videoRef.current
    setVideoError(false)
    if (!video || mode !== 'live') return
    video.srcObject = stream
    if (stream) video.play().catch(() => setVideoError(true))
    onVideoReadyRef.current?.(video)
    return () => {
      video.srcObject = null
      onVideoReadyRef.current?.(null)
    }
  }, [stream, mode])

  useEffect(() => {
    dragRef.current = null
    setDraft(null)
  }, [editingId, mode, stream])

  function point(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selected || event.button !== 0 || (mode === 'live' && !stream)) return
    const { x, y } = point(event)
    const roi = selected.roi
    const inside = roi && x >= roi.x && y >= roi.y && x <= roi.x + roi.width && y <= roi.y + roi.height
    dragRef.current = { id: selected.id, pointerId: event.pointerId, kind: inside ? 'move' : 'draw', startX: x, startY: y, original: roi }
    setDraft(inside ? roi : { x, y, width: 0, height: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    event.preventDefault()
  }

  function getDragROI(event: ReactPointerEvent<HTMLDivElement>): ROI | null {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return null
    const { x, y } = point(event)
    if (drag.kind === 'move' && drag.original) {
      const roi = drag.original
      return { ...roi, x: clamp(roi.x + x - drag.startX, 0, 1 - roi.width), y: clamp(roi.y + y - drag.startY, 0, 1 - roi.height) }
    }
    return { x: Math.min(x, drag.startX), y: Math.min(y, drag.startY), width: Math.abs(x - drag.startX), height: Math.abs(y - drag.startY) }
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const roi = getDragROI(event)
    if (drag && roi && roi.width >= .008 && roi.height >= .008) onRoiChange(drag.id, roi)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDraft(null)
  }

  return (
    <div className="screen-preview-wrap">
      <div
        ref={stageRef}
        className={`screen-preview ${selected ? 'is-editing' : ''} ${mode === 'live' && !stream ? 'is-empty' : ''}`}
        style={{ aspectRatio: mode === 'demo' ? 16 / 9 : aspectRatio }}
        role="group"
        aria-label={selected ? `${selected.name} 인식 영역 편집. 마우스로 드래그하거나 방향키로 영역을 이동하세요.` : '화면 미리보기'}
        tabIndex={selected ? 0 : -1}
        onPointerDown={beginDrag}
        onPointerMove={event => { const roi = getDragROI(event); if (roi) setDraft(roi) }}
        onPointerUp={finishDrag}
        onPointerCancel={() => { dragRef.current = null; setDraft(null) }}
        onKeyDown={event => {
          if (event.key === 'Escape') { onSelectMonitor(null); return }
          if (!selected?.roi || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const step = event.shiftKey ? .05 : .01
          const roi = selected.roi
          onRoiChange(selected.id, { ...roi, x: clamp(roi.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 1 - roi.width), y: clamp(roi.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), 0, 1 - roi.height) })
        }}
      >
        {mode === 'demo' ? <DemoScene running={demoRunning} /> : <>
          <video ref={videoRef} className="screen-video" muted autoPlay playsInline onLoadedMetadata={() => {
            const video = videoRef.current
            if (video && video.videoWidth && video.videoHeight) setAspectRatio(video.videoWidth / video.videoHeight)
          }} onResize={() => {
            const video = videoRef.current
            if (video?.videoWidth && video.videoHeight) setAspectRatio(video.videoWidth / video.videoHeight)
          }} onError={() => setVideoError(true)} />
          {!stream && <div className="preview-empty"><div className="preview-empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M8 21h8m-4-4v4m-3-11 3-3 3 3m-3-3v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></div><strong>함께 볼 화면을 선택해 주세요</strong><p>화면 공유 시작 버튼으로 게임 창 또는 화면을 연결하세요.</p><span>Chrome · 화면 영상은 기기 밖으로 전송되지 않습니다</span></div>}
          {stream && videoError && <div className="preview-empty"><strong>화면 영상을 재생할 수 없습니다</strong><p>화면 공유를 종료한 뒤 다시 연결해 주세요.</p></div>}
        </>}

        {(mode === 'demo' || stream) && monitors.map(monitor => {
          const isSelected = monitor.id === editingId
          const roi = isSelected && draft ? draft : monitor.roi
          if (!roi || (!monitor.enabled && !isSelected)) return null
          return <div key={monitor.id} className={`roi-region ${isSelected ? 'roi-selected' : ''} ${editingId && !isSelected ? 'roi-muted' : ''}`} style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.width * 100}%`, height: `${roi.height * 100}%`, '--roi-color': colorByKind[monitor.kind] } as CSSProperties}>
            <button className={`roi-label ${roi.y < .055 ? 'roi-label-inside' : ''}`} title={`${monitor.name} 인식 영역 편집`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelectMonitor(isSelected ? null : monitor.id) }}><span className="roi-label-dot" />{monitor.name}<span className="roi-label-edit">↗</span></button>
            {isSelected && <><i className="roi-corner top-left" /><i className="roi-corner top-right" /><i className="roi-corner bottom-left" /><i className="roi-corner bottom-right" /><span className="roi-size">{Math.round(roi.width * 100)} × {Math.round(roi.height * 100)}%</span></>}
          </div>
        })}

        {selected && (mode === 'demo' || stream) && <div className="roi-instruction"><span className="roi-crosshair">⌖</span><strong>{selected.name}</strong><span>드래그하여 영역 지정 · 영역 안에서 이동</span><button onPointerDown={event => event.stopPropagation()} onClick={() => onSelectMonitor(null)} aria-label="영역 편집 완료">완료 ✓</button></div>}
      </div>
    </div>
  )
}

export default ScreenPreview
