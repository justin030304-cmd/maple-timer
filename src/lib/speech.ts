/** Web Speech does not expose a gender property. These names are a preference,
 * never a guarantee; users can listen to a sample and choose their own voice. */
const femaleVoiceName = /(?:sun\s*hi|heami|yuna|seoyeon|sora|sun-a|female|선희|혜미|유나|서연|소라|여성|google\s*한국어)/i

export function getKoreanVoices(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter(voice => /^ko(?:[-_]|$)/i.test(voice.lang))
}

export function isLikelyFemaleVoice(voice: SpeechSynthesisVoice): boolean {
  return femaleVoiceName.test(voice.name)
}

/** Honor an available saved choice; otherwise prefer a known female Korean voice.
 * A local voice wins when candidates otherwise have the same preference score. */
export function selectVoice(voices: readonly SpeechSynthesisVoice[], voiceURI = ''): SpeechSynthesisVoice | null {
  const korean = getKoreanVoices(voices)
  const saved = voiceURI ? korean.find(voice => voice.voiceURI === voiceURI) : null
  if (saved) return saved
  return [...korean].sort((left, right) => {
    const score = (voice: SpeechSynthesisVoice) => Number(isLikelyFemaleVoice(voice)) * 4 + Number(voice.localService) * 2 + Number(voice.default)
    return score(right) - score(left)
  })[0] ?? null
}

export type SpeechController = Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel' | 'resume'>
export interface SpeechOptions {
  volume: number
  rate: number
  voiceURI?: string
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

type Request = { text: string; voice: SpeechSynthesisVoice; options: SpeechOptions }
type UtteranceFactory = (text: string) => SpeechSynthesisUtterance
const MAX_PENDING = 4
const START_TIMEOUT_MS = 8_000
const clamp = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const browserSynthesis = () => typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
const browserUtterance = (text: string) => new SpeechSynthesisUtterance(text)

/** Owns a small FIFO instead of cancelling the previous alert whenever another
 * module expires. stop() clears queued alerts and cancels only this page's speech. */
export class SpeechNotifier {
  private readonly synthesis: SpeechController | null
  private readonly createUtterance: UtteranceFactory
  private pending: Request[] = []
  private current: SpeechSynthesisUtterance | null = null
  private startWatchdog: ReturnType<typeof setTimeout> | null = null
  private endWatchdog: ReturnType<typeof setTimeout> | null = null

  constructor(synthesis: SpeechController | null = browserSynthesis(), createUtterance: UtteranceFactory = browserUtterance) {
    this.synthesis = synthesis
    this.createUtterance = createUtterance
  }

  /** True means accepted for playback, not that sound has already been heard.
   * onStart/onError report the speech engine's eventual result. */
  say(text: string, options: SpeechOptions): boolean {
    const content = text.trim().slice(0, 400)
    if (!content) return false
    if (!this.synthesis) {
      options.onError?.('이 브라우저는 음성 알림을 지원하지 않습니다. 기본 알림음을 사용합니다.')
      return false
    }
    let voice: SpeechSynthesisVoice | null
    try { voice = selectVoice(this.synthesis.getVoices(), options.voiceURI) }
    catch {
      options.onError?.('기기의 음성 목록을 불러오지 못했습니다. 기본 알림음을 사용합니다.')
      return false
    }
    if (!voice) {
      options.onError?.('사용 가능한 한국어 음성이 없습니다. 기기에 한국어 음성을 설치하거나 기본 알림음을 선택해 주세요.')
      return false
    }
    if (this.pending.length >= MAX_PENDING) {
      options.onError?.('음성 알림이 밀려 기본 알림음을 사용합니다.')
      return false
    }
    this.pending.push({ text: content, voice, options: { ...options } })
    return this.pump()
  }

  private pump(): boolean {
    if (this.current || !this.synthesis) return true
    const request = this.pending.shift()
    if (!request) return true
    try {
      const utterance = this.createUtterance(request.text)
      utterance.lang = request.voice.lang || 'ko-KR'
      utterance.voice = request.voice
      utterance.rate = clamp(request.options.rate, .7, 1.3, 1)
      utterance.volume = clamp(request.options.volume, 0, 1, .5)
      utterance.pitch = 1
      this.current = utterance
      const finish = (failure: string | null, cancelCurrent = false) => {
        if (this.current !== utterance) return
        this.clearWatchdogs()
        this.current = null
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        // Some engines dispatch error/end synchronously from cancel(). Remove
        // handlers and ownership first so a late event cannot stop the next item.
        if (cancelCurrent) {
          try { this.synthesis?.cancel() } catch { /* continue with fallback */ }
        }
        try {
          if (failure) request.options.onError?.(failure)
          else request.options.onEnd?.()
        } finally { this.pump() }
      }
      let started = false
      utterance.onstart = () => {
        if (this.current !== utterance || started) return
        started = true
        if (this.startWatchdog !== null) clearTimeout(this.startWatchdog)
        this.startWatchdog = null
        // Korean speech is roughly several characters per second. Leave room
        // for a slow device, but never let a missing end event lock the queue.
        const playbackTimeout = clamp(request.text.length / (5 * utterance.rate) * 1_000 + 6_000, 10_000, 60_000, 30_000)
        this.endWatchdog = setTimeout(() => finish('음성 알림이 끝나지 않아 재생을 중단했습니다. 기본 알림음을 사용합니다.', true), playbackTimeout)
        request.options.onStart?.()
      }
      utterance.onend = () => finish(null)
      utterance.onerror = () => finish('음성 알림을 재생하지 못했습니다. 소리 테스트로 권한을 허용하거나 다른 음성을 선택해 주세요.')
      this.startWatchdog = setTimeout(() => finish('음성 알림이 시작되지 않았습니다. 소리 테스트로 권한을 허용하거나 다른 음성을 선택해 주세요.', true), START_TIMEOUT_MS)
      this.synthesis.resume()
      this.synthesis.speak(utterance)
      return true
    } catch {
      this.clearWatchdogs()
      if (this.current) {
        this.current.onstart = null
        this.current.onend = null
        this.current.onerror = null
      }
      this.current = null
      request.options.onError?.('음성 알림을 시작하지 못했습니다. 기본 알림음을 사용합니다.')
      this.pump()
      return false
    }
  }

  private clearWatchdogs(): void {
    if (this.startWatchdog !== null) clearTimeout(this.startWatchdog)
    if (this.endWatchdog !== null) clearTimeout(this.endWatchdog)
    this.startWatchdog = null
    this.endWatchdog = null
  }

  stop(): void {
    this.clearWatchdogs()
    this.pending = []
    if (this.current) {
      this.current.onstart = null
      this.current.onend = null
      this.current.onerror = null
    }
    this.current = null
    try { this.synthesis?.cancel() } catch { /* teardown must also work in unsupported/privacy modes */ }
  }
}
