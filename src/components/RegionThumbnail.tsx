import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { ROI } from '../types'

export default function RegionThumbnail({ videoRef, roi, label }: { videoRef: RefObject<HTMLVideoElement | null>; roi: ROI; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const draw = () => {
      const source = videoRef.current, target = canvas.current
      if (!source || !target || source.readyState < 2) return
      const width = Math.max(1, roi.width * source.videoWidth), height = Math.max(1, roi.height * source.videoHeight)
      const scale = Math.min(2, 1000 / width, 120 / height)
      target.width = Math.max(1, Math.round(width * scale)); target.height = Math.max(1, Math.round(height * scale))
      target.getContext('2d')?.drawImage(source, roi.x * source.videoWidth, roi.y * source.videoHeight, width, height, 0, 0, target.width, target.height)
    }
    draw(); const timer = window.setInterval(draw, 700)
    return () => clearInterval(timer)
  }, [videoRef, roi.x, roi.y, roi.width, roi.height])
  return <canvas ref={canvas} className="region-thumbnail" aria-label={label} />
}
