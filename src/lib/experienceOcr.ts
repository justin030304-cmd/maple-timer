import { createWorker, OEM, PSM } from 'tesseract.js';
import { MIN_EXPERIENCE_CONFIDENCE, parseExperienceText } from './experience';

export interface ExperienceOcrResult {
  text: string;
  confidence: number;
}

export interface ExperienceReader {
  recognize(image: HTMLCanvasElement): Promise<ExperienceOcrResult>;
  terminate(): Promise<void>;
}

async function withDeadline<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Every worker/core/model request stays on the site's own origin. The canvas
 * is passed to a local Web Worker; it is never uploaded to an OCR service. */
export async function createExperienceReader(): Promise<ExperienceReader> {
  const assetBase = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href);
  let initializing = true;
  let initializationFailed: (error: Error) => void = () => {};
  const initializationFailure = new Promise<never>((_, reject) => { initializationFailed = reject; });
  const creating = createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: new URL('worker.min.js', assetBase).href,
    corePath: assetBase.href,
    langPath: assetBase.href.replace(/\/$/, ''),
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    errorHandler: (cause: unknown) => {
      // Tesseract's default handler throws from an event callback. Reject our
      // initialization instead; normal recognition errors reject their own job.
      if (initializing) initializationFailed(new Error('경험치 OCR 파일을 불러오지 못했습니다. 연결을 확인한 뒤 다시 켜 주세요.', { cause }));
    },
  }, {
    load_system_dawg: '0',
    load_freq_dawg: '0',
    load_unambig_dawg: '0',
    load_punc_dawg: '0',
    load_number_dawg: '0',
    load_bigram_dawg: '0',
  });
  let worker: Awaited<typeof creating>;
  try {
    worker = await withDeadline(Promise.race([creating, initializationFailure]), 45_000, '경험치 OCR 준비 시간이 초과되었습니다. 연결을 확인한 뒤 다시 켜 주세요.');
  } catch (error) {
    // If a delayed engine finally initializes after the UI has given up, release it.
    void creating.then(lateWorker => lateWorker.terminate()).catch(() => {});
    throw error;
  } finally { initializing = false; }

  try {
    await withDeadline(worker.setParameters({
      // The entire EXP row is one raw text line, including commas/percentage.
      tessedit_pageseg_mode: PSM.RAW_LINE,
      tessedit_char_whitelist: '0123456789.,[]()% ',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    }), 15_000, '경험치 OCR 설정 시간이 초과되었습니다. 다시 켜 주세요.');
  } catch (error) {
    await worker.terminate();
    throw error;
  }

  let ended = false;
  let busy = false;
  const terminate = async () => {
    if (ended) return;
    ended = true;
    await worker.terminate();
  };
  return {
    async recognize(image) {
      if (ended) throw new Error('경험치 숫자 인식기가 종료되었습니다.');
      if (busy) throw new Error('이전 경험치 숫자를 읽는 중입니다.');
      busy = true;
      try {
        return await withDeadline((async () => {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.RAW_LINE });
          const first = (await worker.recognize(image, {}, { text: true })).data;
          let best = { text: first.text.trim(), confidence: first.confidence };
          if (parseExperienceText(best.text) && best.confidence >= MIN_EXPERIENCE_CONFIDENCE) return best;
          // Small game glyphs can score poorly in raw-line mode. Try normal
          // line segmentation without relaxing numeric validity or confidence.
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
          for (const candidate of [image]) {
            const { data } = await worker.recognize(candidate, {}, { text: true });
            const next = { text: data.text.trim(), confidence: data.confidence };
            if (parseExperienceText(next.text) && (!parseExperienceText(best.text) || next.confidence > best.confidence)) best = next;
            if (parseExperienceText(best.text) && best.confidence >= MIN_EXPERIENCE_CONFIDENCE) break;
          }
          return best;
        })(), 15_000, '경험치 숫자 인식 시간이 초과되었습니다. 인식 영역을 좁히고 다시 켜 주세요.');
      } catch (error) {
        await terminate();
        throw error;
      } finally { busy = false; }
    },
    terminate,
  };
}
