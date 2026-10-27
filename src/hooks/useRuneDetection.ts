import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Monitor, ROI, RuneDetectorSettings } from '../types';
import { advanceRuneState, createRuneState, DEFAULT_RUNE_PRESENCE_OPTIONS, detectRune } from '../lib/rune';

export interface RuneObservation {
  present: boolean;
  score: number | null;
  frameError?: string | null;
  hint?: string;
}

/** Only the selected minimap crop is processed, in this browser's memory. */
export function useRuneDetection({ stream, videoRef, monitor, settings, onDetected }: {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  monitor: Monitor | undefined;
  settings: RuneDetectorSettings;
  onDetected: (timestamp: number) => void;
}) {
  const [observation, setObservation] = useState<RuneObservation | undefined>();
  const [candidate, setCandidate] = useState<ROI | null>(null);
  const presence = useRef(createRuneState());
  const callbackRef = useRef(onDetected);
  callbackRef.current = onDetected;
  const roi = monitor?.roi;

  useEffect(() => {
    presence.current = createRuneState();
    setObservation(undefined);
    setCandidate(null);
  }, [stream, monitor?.id, monitor?.enabled, roi?.x, roi?.y, roi?.width, roi?.height]);

  useEffect(() => {
    if (!stream || !monitor?.enabled || !roi) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const fail = (message: string) => {
      presence.current = advanceRuneState(presence.current, null, Date.now(), DEFAULT_RUNE_PRESENCE_OPTIONS).state;
      setObservation({ present: presence.current.present, score: null, frameError: message });
      setCandidate(null);
    };
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        fail('룬 감시용 화면 프레임을 읽을 수 없습니다. 공유 창이 최소화되었는지 확인해 주세요.');
        return;
      }
      try {
        if (!context) throw new Error('canvas');
        const sourceWidth = roi.width * video.videoWidth;
        const sourceHeight = roi.height * video.videoHeight;
        const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        context.imageSmoothingEnabled = false;
        context.drawImage(video, roi.x * video.videoWidth, roi.y * video.videoHeight, sourceWidth, sourceHeight, 0, 0, width, height);
        const minimum = Math.max(3, Math.round(settings.minSize * scale));
        const result = detectRune(context.getImageData(0, 0, width, height), {
          color: 'pink-cyan',
          minSize: minimum,
          maxSize: Math.max(minimum, Math.round(settings.maxSize * scale)),
          minScore: settings.minScore,
        });
        const timestamp = Date.now();
        const next = advanceRuneState(presence.current, result.candidate !== null, timestamp, DEFAULT_RUNE_PRESENCE_OPTIONS);
        presence.current = next.state;
        setObservation({
          present: next.state.present,
          score: result.candidate?.score ?? null,
          frameError: null,
          hint: scale < .6 ? '인식 영역이 넓습니다. 작은 아이콘을 보려면 미니맵 부분만 좁게 지정해 주세요.' : undefined,
        });
        const found = result.candidate;
        if (found) setCandidate({
          x: roi.x + found.x / width * roi.width,
          y: roi.y + found.y / height * roi.height,
          width: found.width / width * roi.width,
          height: found.height / height * roi.height,
        });
        else if (!next.state.present) setCandidate(null);
        if (next.triggered) callbackRef.current(timestamp);
      } catch {
        fail('룬 인식 영역의 분석에 실패했습니다. 영역을 다시 지정하거나 화면을 다시 공유해 주세요.');
      }
    }, 250);
    return () => clearInterval(id);
  }, [stream, videoRef, monitor?.enabled, roi?.x, roi?.y, roi?.width, roi?.height, settings.minSize, settings.maxSize, settings.minScore]);

  return { observation, candidate };
}
