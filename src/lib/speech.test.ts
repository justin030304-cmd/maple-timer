import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKoreanVoices, isLikelyFemaleVoice, selectVoice, SpeechNotifier } from './speech'
import type { SpeechController } from './speech'

const activeNotifiers = new Set<SpeechNotifier>()
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const notifier of activeNotifiers) notifier.stop()
  activeNotifiers.clear()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function voice(name: string, overrides: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return { name, voiceURI: name, lang: 'ko-KR', localService: true, default: false, ...overrides }
}

function makeUtterance(text: string): SpeechSynthesisUtterance {
  return { text, lang: '', voice: null, volume: 1, rate: 1, pitch: 1, onstart: null, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance
}

function setup(voices = [voice('Microsoft SunHi')]) {
  const spoken: SpeechSynthesisUtterance[] = []
  const controller = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => { spoken.push(utterance) }),
    cancel: vi.fn(),
    resume: vi.fn(),
  } satisfies SpeechController
  const notifier = new SpeechNotifier(controller, makeUtterance)
  activeNotifiers.add(notifier)
  return { spoken, controller, notifier }
}

function end(utterance: SpeechSynthesisUtterance) {
  utterance.onend?.call(utterance, {} as SpeechSynthesisEvent)
}
function start(utterance: SpeechSynthesisUtterance) {
  utterance.onstart?.call(utterance, {} as SpeechSynthesisEvent)
}
function fail(utterance: SpeechSynthesisUtterance) {
  utterance.onerror?.call(utterance, {} as SpeechSynthesisErrorEvent)
}
const options = { volume: .5, rate: 1 }

describe('available Korean voices', () => {
  it('accepts Korean language tags in different browser formats without including other languages', () => {
    const voices = [voice('Korean'), voice('Korean uppercase', { lang: 'KO-kr' }), voice('Korean underscore', { lang: 'ko_KR' }), voice('Korean generic', { lang: 'ko' }), voice('English', { lang: 'en-US' }), voice('Unrelated', { lang: 'kok-IN' })]
    expect(getKoreanVoices(voices).map(item => item.name)).toEqual(['Korean', 'Korean uppercase', 'Korean underscore', 'Korean generic'])
  })

  it('recognizes known female names as a preference, leaving unrecognized names unclassified', () => {
    expect(isLikelyFemaleVoice(voice('Microsoft SunHi Online (Natural)'))).toBe(true)
    expect(isLikelyFemaleVoice(voice('Google 한국어'))).toBe(true)
    expect(isLikelyFemaleVoice(voice('알 수 없는 한국어 음성'))).toBe(false)
  })

  it('honors an available Korean saved choice even when another voice scores higher', () => {
    const chosen = voice('사용자가 선택한 음성', { localService: false })
    expect(selectVoice([voice('Microsoft SunHi'), chosen], chosen.voiceURI)).toBe(chosen)
  })

  it('prefers known female Korean voices and then local voices among suitable candidates', () => {
    const localFemale = voice('Microsoft Heami')
    const remoteFemale = voice('Microsoft SunHi', { localService: false, default: true })
    const localUnknown = voice('알 수 없는 음성', { default: true })
    expect(selectVoice([localUnknown, remoteFemale, localFemale])).toBe(localFemale)
    expect(selectVoice([localUnknown, remoteFemale])).toBe(remoteFemale)
  })

  it('falls back safely after a saved voice disappears, without choosing an English voice', () => {
    const korean = voice('사용 가능한 한국어')
    const english = voice('English female', { lang: 'en-US' })
    expect(selectVoice([english, korean], 'removed-device-voice')).toBe(korean)
    expect(selectVoice([english], english.voiceURI)).toBeNull()
  })
})

describe('speech notification lifecycle', () => {
  it('returns false with a useful error when speech synthesis or Korean voices are unavailable', () => {
    const unsupportedError = vi.fn()
    expect(new SpeechNotifier(null, makeUtterance).say('경험치 변화가 없습니다.', { ...options, onError: unsupportedError })).toBe(false)
    expect(unsupportedError).toHaveBeenCalledWith(expect.stringContaining('지원하지 않습니다'))
    const { notifier, controller } = setup([voice('English', { lang: 'en-US' })])
    const voiceError = vi.fn()
    expect(notifier.say('경험치 변화가 없습니다.', { ...options, onError: voiceError })).toBe(false)
    expect(voiceError).toHaveBeenCalledWith(expect.stringContaining('한국어 음성이 없습니다'))
    expect(controller.speak).not.toHaveBeenCalled()
  })

  it('waits for actual speech engine start instead of treating queue acceptance as successful playback', () => {
    const { notifier, spoken } = setup()
    const onStart = vi.fn(), onEnd = vi.fn()
    expect(notifier.say('경험치 변화가 없습니다.', { ...options, onStart, onEnd })).toBe(true)
    expect(onStart).not.toHaveBeenCalled()
    start(spoken[0])
    expect(onStart).toHaveBeenCalledTimes(1)
    end(spoken[0])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('keeps simultaneous module alerts in FIFO order without cancelling a playing alert', () => {
    const { notifier, spoken, controller } = setup()
    notifier.say('룬 알림', options)
    notifier.say('버프 알림', options)
    notifier.say('경험치 알림', options)
    expect(spoken.map(item => item.text)).toEqual(['룬 알림'])
    end(spoken[0])
    expect(spoken.map(item => item.text)).toEqual(['룬 알림', '버프 알림'])
    end(spoken[1])
    expect(spoken.map(item => item.text)).toEqual(['룬 알림', '버프 알림', '경험치 알림'])
    expect(controller.cancel).not.toHaveBeenCalled()
  })

  it('bounds pending alerts to four while preserving already accepted alerts', () => {
    const { notifier, spoken } = setup()
    for (let index = 0; index < 5; index++) expect(notifier.say(`알림 ${index}`, options)).toBe(true)
    const onError = vi.fn()
    expect(notifier.say('대기열 초과', { ...options, onError })).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('밀려'))
    for (let index = 0; index < 5; index++) end(spoken[index])
    expect(spoken.map(item => item.text)).toEqual(['알림 0', '알림 1', '알림 2', '알림 3', '알림 4'])
  })

  it('applies selected voice and clamps playback settings', () => {
    const chosen = voice('내가 선택한 한국어')
    const { notifier, spoken } = setup([voice('Microsoft SunHi'), chosen])
    notifier.say('  경험치 알림  ', { voiceURI: chosen.voiceURI, volume: 8, rate: .1 })
    expect(spoken[0]).toMatchObject({ text: '경험치 알림', lang: 'ko-KR', voice: chosen, volume: 1, rate: .7, pitch: 1 })
    end(spoken[0])
    notifier.say('기본값 알림', { volume: Number.NaN, rate: Number.POSITIVE_INFINITY })
    expect(spoken[1]).toMatchObject({ volume: .5, rate: 1 })
  })

  it('surfaces asynchronous playback failures and continues with the next accepted alert', () => {
    const { notifier, spoken } = setup()
    const onError = vi.fn(), onEnd = vi.fn()
    notifier.say('실패할 알림', { ...options, onError, onEnd })
    notifier.say('다음 알림', options)
    fail(spoken[0])
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('재생하지 못했습니다'))
    expect(onEnd).not.toHaveBeenCalled()
    expect(spoken[1].text).toBe('다음 알림')
  })

  it('clears pending speech and ignores stale callbacks after stop', () => {
    const { notifier, spoken, controller } = setup()
    const onError = vi.fn(), onEnd = vi.fn()
    notifier.say('진행 중인 알림', { ...options, onError, onEnd })
    notifier.say('취소할 대기 알림', options)
    const staleError = spoken[0].onerror
    const staleEnd = spoken[0].onend
    notifier.stop()
    staleError?.call(spoken[0], {} as SpeechSynthesisErrorEvent)
    staleEnd?.call(spoken[0], {} as SpeechSynthesisEvent)
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(spoken).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
    notifier.say('새 알림', options)
    expect(spoken[1].text).toBe('새 알림')
  })

  it('handles a synchronous speech engine exception without leaving the queue locked', () => {
    const { notifier, controller, spoken } = setup()
    const onError = vi.fn()
    controller.speak.mockImplementationOnce(() => { throw new Error('Unavailable') })
    expect(notifier.say('실패 알림', { ...options, onError })).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('시작하지 못했습니다'))
    expect(notifier.say('재시도 알림', options)).toBe(true)
    expect(spoken[0].text).toBe('재시도 알림')
  })

  it('rejects empty text and limits unusually long notifications', () => {
    const { notifier, spoken } = setup()
    expect(notifier.say('   ', options)).toBe(false)
    expect(spoken).toHaveLength(0)
    notifier.say('가'.repeat(500), options)
    expect(spoken[0].text).toHaveLength(400)
  })
})


describe('speech engine watchdogs', () => {
  it('cancels a request that never starts after eight seconds and advances the FIFO', () => {
    const { notifier, spoken, controller } = setup()
    const onError = vi.fn()
    notifier.say('시작하지 않을 알림', { ...options, onError })
    notifier.say('대기 중인 다음 알림', options)
    vi.advanceTimersByTime(7_999)
    expect(controller.cancel).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('시작되지 않았습니다'))
    expect(spoken.map(item => item.text)).toEqual(['시작하지 않을 알림', '대기 중인 다음 알림'])
    expect(vi.getTimerCount()).toBe(1)
    start(spoken[1])
    end(spoken[1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces the start timer with a ten-second minimum playback timeout after onstart', () => {
    const { notifier, spoken, controller } = setup()
    const onError = vi.fn()
    notifier.say('짧은 알림', { ...options, onError })
    vi.advanceTimersByTime(7_999)
    start(spoken[0])
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(9_999)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('끝나지 않아'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows a longer message a playback interval based on text length and rate', () => {
    const { notifier, spoken } = setup()
    const onError = vi.fn()
    notifier.say('가'.repeat(100), { ...options, rate: 1, onError })
    start(spoken[0])
    // 100 characters / (5 chars per second * rate 1) + 6 seconds grace.
    vi.advanceTimersByTime(25_999)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('bounds playback timeout to sixty seconds even for long text at the slowest rate', () => {
    const { notifier, spoken } = setup()
    const onError = vi.fn()
    notifier.say('가'.repeat(400), { ...options, rate: .1, onError })
    expect(spoken[0].rate).toBe(.7)
    start(spoken[0])
    vi.advanceTimersByTime(59_999)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('advances queued alerts after a playback timeout instead of locking the queue', () => {
    const { notifier, spoken, controller } = setup()
    const firstError = vi.fn(), secondError = vi.fn()
    notifier.say('끝나지 않을 알림', { ...options, onError: firstError })
    notifier.say('정상 재생할 알림', { ...options, onError: secondError })
    start(spoken[0])
    vi.advanceTimersByTime(10_000)
    expect(firstError).toHaveBeenCalledTimes(1)
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(spoken[1].text).toBe('정상 재생할 알림')
    start(spoken[1])
    end(spoken[1])
    vi.advanceTimersByTime(60_000)
    expect(secondError).not.toHaveBeenCalled()
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears both watchdogs on normal finish so no later fallback is triggered', () => {
    const { notifier, spoken, controller } = setup()
    const onError = vi.fn(), onEnd = vi.fn()
    notifier.say('정상 알림', { ...options, onError, onEnd })
    expect(vi.getTimerCount()).toBe(1)
    start(spoken[0])
    expect(vi.getTimerCount()).toBe(1)
    end(spoken[0])
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(onError).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(controller.cancel).not.toHaveBeenCalled()
  })

  it('clears waiting-start and playing-end timers on stop without later error callbacks', () => {
    const { notifier, spoken } = setup()
    const onError = vi.fn()
    notifier.say('시작 전 알림', { ...options, onError })
    notifier.say('대기 알림', { ...options, onError })
    notifier.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(spoken).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
    notifier.say('재생 후 취소할 알림', { ...options, onError })
    start(spoken[1])
    expect(vi.getTimerCount()).toBe(1)
    notifier.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(onError).not.toHaveBeenCalled()
  })

  it('ignores stale events and cleared timeouts while a replacement utterance plays', () => {
    const { notifier, spoken, controller } = setup()
    const oldError = vi.fn(), newError = vi.fn(), newEnd = vi.fn()
    notifier.say('이전 알림', { ...options, onError: oldError })
    start(spoken[0])
    const staleStart = spoken[0].onstart, staleError = spoken[0].onerror, staleEnd = spoken[0].onend
    notifier.stop()
    notifier.say('새 알림', { ...options, onError: newError, onEnd: newEnd })
    start(spoken[1])
    staleStart?.call(spoken[0], {} as SpeechSynthesisEvent)
    staleError?.call(spoken[0], {} as SpeechSynthesisErrorEvent)
    staleEnd?.call(spoken[0], {} as SpeechSynthesisEvent)
    vi.advanceTimersByTime(8_000)
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(oldError).not.toHaveBeenCalled()
    expect(newError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    end(spoken[1])
    vi.advanceTimersByTime(60_000)
    expect(newEnd).toHaveBeenCalledTimes(1)
    expect(newError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('survives engines that synchronously emit a stale error from cancel during timeout', () => {
    const { notifier, spoken, controller } = setup()
    const firstError = vi.fn(), secondError = vi.fn()
    notifier.say('시작되지 않을 알림', { ...options, onError: firstError })
    notifier.say('다음 알림', { ...options, onError: secondError })
    const staleError = spoken[0].onerror
    controller.cancel.mockImplementation(() => staleError?.call(spoken[0], {} as SpeechSynthesisErrorEvent))
    vi.advanceTimersByTime(8_000)
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(firstError).toHaveBeenCalledTimes(1)
    expect(spoken).toHaveLength(2)
    expect(secondError).not.toHaveBeenCalled()
    start(spoken[1])
    end(spoken[1])
    vi.advanceTimersByTime(60_000)
    expect(secondError).not.toHaveBeenCalled()
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
