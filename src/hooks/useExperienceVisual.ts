import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Monitor } from '../types'
import type { ExpObservation } from '../lib/engine'
import { experienceGlyphs, experienceGlyphsChanged } from '../lib/experienceVisual'
import type { GlyphSample } from '../lib/experienceVisual'

export function useExperienceVisual(stream: MediaStream | null, videoRef: RefObject<HTMLVideoElement | null>, monitor: Monitor | undefined, retry: number) {
  const [view, setView] = useState<{ observation: ExpObservation | undefined; sourcePreview: string | null }>({ observation: undefined, sourcePreview: null })
  const roi = monitor?.roi
  useEffect(() => {
    setView({ observation: undefined, sourcePreview: null })
    if (!stream || !monitor?.enabled || !roi) return
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    let baseline: GlyphSample | null = null, lastChangedAt: number | null = null, confirmed = false, pendingChange = false
    let lastSampleAt = 0
    const sample = () => {
      const now = Date.now()
      if (lastSampleAt && now - lastSampleAt > 4000) { baseline = null; lastChangedAt = null; confirmed = false; pendingChange = false }
      lastSampleAt = now
      let sourcePreview: string | null = null
      try {
        const video = videoRef.current
        if (!context || !video || video.readyState < 2 || !video.videoWidth) throw new Error('공유 화면을 읽을 수 없습니다.')
        canvas.width = Math.max(1, Math.round(roi.width * video.videoWidth))
        canvas.height = Math.max(1, Math.round(roi.height * video.videoHeight))
        if (canvas.width > 4096 || canvas.height > 80) throw new Error('경험치 숫자 한 줄만 포함하도록 영역을 지정해 주세요.')
        context.drawImage(video, roi.x * video.videoWidth, roi.y * video.videoHeight, roi.width * video.videoWidth, roi.height * video.videoHeight, 0, 0, canvas.width, canvas.height)
        sourcePreview = canvas.toDataURL('image/png')
        const glyphs = experienceGlyphs(context.getImageData(0, 0, canvas.width, canvas.height))
        if (!baseline) { baseline = glyphs; lastChangedAt = now }
        else {
          const changed = experienceGlyphsChanged(baseline, glyphs)
          if (changed && !pendingChange) {
            // A possible change suppresses expiry while the next frame checks it.
            pendingChange = true
          } else {
            if (changed) { baseline = glyphs; lastChangedAt = now }
            pendingChange = false; confirmed = true
          }
        }
        setView({ sourcePreview, observation: { value: '숫자 모양 확인됨', valid: confirmed, confirming: !confirmed, changePending: confirmed && pendingChange, lastChangedAt, lastReadAt: now } })
      } catch (error) {
        baseline = null; lastChangedAt = null; confirmed = false; pendingChange = false
        setView({ sourcePreview, observation: { value: null, valid: false, lastChangedAt: null, lastReadAt: null, error: error instanceof Error ? error.message : '경험치 숫자 모양을 확인하지 못했습니다.' } })
      }
    }
    sample()
    const timer = window.setInterval(sample, 500)
    return () => clearInterval(timer)
  }, [stream, videoRef, monitor?.enabled, roi?.x, roi?.y, roi?.width, roi?.height, retry])
  return view
}
