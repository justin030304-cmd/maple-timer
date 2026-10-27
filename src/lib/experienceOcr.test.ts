import { afterEach, describe, expect, it, vi } from 'vitest';
const worker = vi.hoisted(() => ({ setParameters: vi.fn().mockResolvedValue(undefined), recognize: vi.fn(), terminate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('tesseract.js', () => ({ createWorker: vi.fn().mockResolvedValue(worker), OEM: { LSTM_ONLY: 1 }, PSM: { RAW_LINE: '13', SINGLE_LINE: '7' } }));
import { createExperienceReader } from './experienceOcr';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('experience OCR retry', () => {
  it('retries a low scoring but exact integer with normal line segmentation', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/maple-timer/' } });
    worker.recognize.mockResolvedValueOnce({ data: { text: '589.962.110.687.476 [7.780%]', confidence: 26 } })
      .mockResolvedValueOnce({ data: { text: '589,962,110,687,476 [67.670%]', confidence: 85 } });
    const reader = await createExperienceReader();
    expect(await reader.recognize({} as HTMLCanvasElement)).toEqual({ text: '589,962,110,687,476 [67.670%]', confidence: 85 });
    expect(worker.setParameters).toHaveBeenLastCalledWith({ tessedit_pageseg_mode: '7' });
    await reader.terminate();
  });
  it('preserves low confidence when neither reading is reliable', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/' } });
    worker.recognize.mockResolvedValueOnce({ data: { text: '589.962.110.687.476 [7.780%]', confidence: 26 } })
      .mockResolvedValueOnce({ data: { text: '589,962,110,687,476 [67.670%]', confidence: 30 } });
    const reader = await createExperienceReader();
    expect((await reader.recognize({} as HTMLCanvasElement)).confidence).toBe(30);
    await reader.terminate();
  });
});
