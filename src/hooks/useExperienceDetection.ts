import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Monitor } from '../types';
import type { ExpObservation } from '../lib/engine';
import { createExperienceReader } from '../lib/experienceOcr';
import type { ExperienceReader } from '../lib/experienceOcr';
import { advanceExperienceState, createExperienceState, MIN_EXPERIENCE_CONFIDENCE, parseExperienceText } from '../lib/experience';
import type { ExperienceValue } from '../lib/experience';
import { prepareExperienceImage } from '../lib/experienceImage';

interface ExperienceView {
  observation: ExpObservation | undefined;
  value: ExperienceValue | null;
  confidence: number | null;
  rawText: string;
  preview: string | null;
}
const emptyView = (): ExperienceView => ({ observation: undefined, value: null, confidence: null, rawText: '', preview: null });

/** One local OCR job at a time. ROI changes invalidate in-flight results while
 * retaining the worker; stopping sharing terminates it and cancels all polling. */
export function useExperienceDetection({ stream, videoRef, monitor }: {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  monitor: Monitor | undefined;
}) {
  const [view, setView] = useState<ExperienceView>(emptyView);
  const [retryVersion, setRetryVersion] = useState(0);
  const tracker = useRef(createExperienceState());
  const generation = useRef(0);
  const readerRef = useRef<ExperienceReader | null>(null);
  const fatalError = useRef<string | null>(null);
  const roi = monitor?.roi;
  const roiRef = useRef(roi);
  roiRef.current = roi;
  const active = !!stream && !!monitor?.enabled && !!roi;

  useEffect(() => {
    generation.current++;
    tracker.current = createExperienceState();
    setView({ ...emptyView(), observation: active ? {
      value: null, lastChangedAt: null, lastReadAt: null, valid: false,
      loading: !readerRef.current && !fatalError.current, confirming: !!readerRef.current && !fatalError.current, error: fatalError.current,
    } : undefined });
  }, [stream, monitor?.id, monitor?.enabled, roi?.x, roi?.y, roi?.width, roi?.height, retryVersion, active]);

  useEffect(() => {
    if (!active) return;
    fatalError.current = null;
    setView((previous) => ({ ...previous, observation: { value: null, lastChangedAt: null, lastReadAt: null, valid: false, loading: true } }));
    let disposed = false;
    let reader: ExperienceReader | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const crop = document.createElement('canvas');
    const context = crop.getContext('2d', { willReadFrequently: true });
    const preparedCanvas = document.createElement('canvas');
    const preparedContext = preparedCanvas.getContext('2d');
    const invalidate = (message: string, rawText = '', confidence: number | null = null) => {
      tracker.current = advanceExperienceState(tracker.current, null, Date.now()).state;
      setView((previous) => ({ ...previous, value: tracker.current.value, rawText, confidence, preview: null,
        observation: { value: tracker.current.value?.display ?? null, lastChangedAt: null, lastReadAt: tracker.current.lastReadAt, valid: false, error: message, loading: false },
      }));
    };
    const schedule = () => { if (!disposed) timer = setTimeout(() => { void sample(); }, 1100); };
    const sample = async () => {
      if (disposed || !reader) return;
      const sampleGeneration = generation.current;
      const currentROI = roiRef.current;
      const video = videoRef.current;
      let image: ImageData;
      let capturedAt: number;
      try {
        if (!currentROI || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('공유 화면을 읽을 수 없습니다. 게임 창이 최소화되었는지 확인해 주세요.');
        const width = Math.max(1, Math.round(currentROI.width * video.videoWidth));
        const height = Math.max(1, Math.round(currentROI.height * video.videoHeight));
        if (width > 4096 || height > 256) throw new Error('경험치 인식 영역이 너무 큽니다. 하단 연두색 바의 숫자 부분만 좁게 지정해 주세요.');
        if (!context || !preparedContext) throw new Error('경험치 인식용 화면을 만들 수 없습니다. 브라우저를 확인해 주세요.');
        if (crop.width !== width || crop.height !== height) { crop.width = width; crop.height = height; }
        context.drawImage(video, currentROI.x * video.videoWidth, currentROI.y * video.videoHeight, currentROI.width * video.videoWidth, currentROI.height * video.videoHeight, 0, 0, width, height);
        capturedAt = Date.now();
        image = context.getImageData(0, 0, width, height);
        const prepared = prepareExperienceImage(image, { preserveAntialias: true });
        preparedCanvas.width = prepared.width;
        preparedCanvas.height = prepared.height;
        preparedContext.putImageData(new ImageData(new Uint8ClampedArray(prepared.data), prepared.width, prepared.height), 0, 0);
      } catch (error) {
        if (!disposed && sampleGeneration === generation.current) {
          const message = error instanceof Error ? error.message : '';
          invalidate(message.includes('경험치') || message.includes('공유 화면') ? message : '경험치 숫자 영역의 화면 분석에 실패했습니다. 영역을 다시 지정해 주세요.');
        }
        schedule();
        return;
      }
      try {
        const result = await reader.recognize(preparedCanvas);
        if (disposed) return;
        if (sampleGeneration !== generation.current) { schedule(); return; }
        const value = parseExperienceText(result.text);
        const next = advanceExperienceState(tracker.current, value ? { value, confidence: result.confidence } : null, capturedAt);
        tracker.current = next.state;
        const confident = !!value && Number.isFinite(result.confidence) && result.confidence >= MIN_EXPERIENCE_CONFIDENCE;
        const confirming = confident && !next.state.valid && next.state.pendingReadings > 0;
        const error = !value ? '경험치 숫자를 읽지 못했습니다. 연두색 바의 흰 숫자 전체가 들어오도록 영역을 조정해 주세요.'
          : !confident ? '경험치 숫자를 확실히 읽지 못했습니다. 숫자 영역을 좁히거나 게임 화면 배율을 확인해 주세요.' : null;
        setView({
          value: next.state.value,
          confidence: result.confidence,
          rawText: result.text.slice(0, 180),
          preview: preparedCanvas.toDataURL('image/png'),
          observation: {
            value: next.state.value?.display ?? null,
            lastChangedAt: next.state.lastChangedAt,
            lastReadAt: next.state.lastReadAt,
            valid: next.state.valid,
            confirming,
            loading: false,
            error,
          },
        });
      } catch {
        if (!disposed) {
          fatalError.current = '경험치 숫자 인식기가 중단되었습니다. 영역을 확인한 뒤 숫자 인식 다시 시작을 눌러 주세요.';
          invalidate(fatalError.current);
        }
        // The reader terminates on a worker failure. Avoid retry loops on a dead engine.
        return;
      }
      schedule();
    };
    void (async () => {
      try {
        reader = await createExperienceReader();
        if (disposed) { await reader.terminate(); return; }
        readerRef.current = reader;
        await sample();
      } catch (error) {
        if (!disposed) {
          fatalError.current = error instanceof Error ? error.message : '경험치 숫자 인식 모델을 준비하지 못했습니다. 다시 시작해 주세요.';
          invalidate(fatalError.current);
        }
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      generation.current++;
      if (readerRef.current === reader) readerRef.current = null;
      void reader?.terminate().catch(() => {});
    };
  }, [stream, videoRef, monitor?.id, monitor?.enabled, active, retryVersion]);

  const retry = useCallback(() => { setRetryVersion((previous) => previous + 1); }, []);
  return { ...view, retry };
}
