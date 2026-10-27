import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/lib/settings'

type SpokenAlert = { text: string; voiceURI: string | null; volume: number; rate: number }

declare global {
  interface Window {
    __capture?: { canvas: HTMLCanvasElement; stream: MediaStream; track: MediaStreamTrack & { requestFrame?: () => void } }
    __captureOptions?: DisplayMediaStreamOptions
    __spoken?: SpokenAlert[]
    __cancelCount?: number
    __loadSpeechVoices?: () => void
    __experienceAnimation?: number
    __ocrRecognizePosts?: number
  }
}

const card = (page: Page, name: string) => page.locator('.monitor-item').filter({ has: page.getByRole('button', { name, exact: true }) })
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).settings, SETTINGS_KEY)

async function mockCapture(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async (options: DisplayMediaStreamOptions) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280; canvas.height = 720
      const context = canvas.getContext('2d')!
      context.fillStyle = '#111111'; context.fillRect(0, 0, canvas.width, canvas.height)
      const stream = canvas.captureStream(10)
      const track = stream.getVideoTracks()[0]
      window.__capture = { canvas, stream, track }
      window.__captureOptions = options
      return stream
    } })
  })
}

/** A deterministic browser speech engine: tests verify utterances, never claim speaker output. */
async function mockSpeech(page: Page, delayedVoices = false, stalledPlayback = false) {
  await page.addInitScript(({ delayed, stalled }) => {
    const voices = [
      { name: 'Microsoft SunHi - Korean (Korea)', lang: 'ko-KR', voiceURI: 'uri-sunhi', localService: true, default: true },
      { name: 'Microsoft InJoon - Korean (Korea)', lang: 'ko-KR', voiceURI: 'uri-injoon', localService: true, default: false },
      { name: 'English voice', lang: 'en-US', voiceURI: 'uri-english', localService: true, default: false },
    ]
    let available = delayed ? [] : voices
    window.__spoken = []
    window.__cancelCount = 0
    class MockUtterance extends EventTarget {
      text: string
      lang = ''
      voice: typeof voices[number] | null = null
      volume = 1
      rate = 1
      pitch = 1
      onend: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onstart: ((event: Event) => void) | null = null
      constructor(text = '') { super(); this.text = text }
    }
    const synthesis = Object.assign(new EventTarget(), {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null as ((event: Event) => void) | null,
      getVoices: () => available,
      speak: (utterance: MockUtterance) => {
        window.__spoken!.push({ text: utterance.text, voiceURI: utterance.voice?.voiceURI ?? null, volume: utterance.volume, rate: utterance.rate })
        synthesis.speaking = true
        if (stalled) return
        const start = new Event('start')
        utterance.dispatchEvent(start); utterance.onstart?.(start)
        setTimeout(() => {
          synthesis.speaking = false
          const end = new Event('end')
          utterance.dispatchEvent(end); utterance.onend?.(end)
        }, 20)
      },
      cancel: () => { window.__cancelCount! += 1; synthesis.speaking = false; synthesis.pending = false },
      pause: () => { synthesis.paused = true },
      resume: () => { synthesis.paused = false },
    })
    window.__loadSpeechVoices = () => {
      available = voices
      const event = new Event('voiceschanged')
      synthesis.dispatchEvent(event); synthesis.onvoiceschanged?.(event)
    }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: MockUtterance })
  }, { delayed: delayedVoices, stalled: stalledPlayback })
}

async function seedRegions(page: Page, expIdleSec = 5) {
  await page.addInitScript(({ key, settings }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings }))
  }, { key: SETTINGS_KEY, settings: { ...DEFAULT_SETTINGS, expIdleSec, monitors: DEFAULT_SETTINGS.monitors.map(monitor => ({ ...monitor, enabled: monitor.kind === 'exp' ? false : monitor.enabled, roi: { x: .1, y: .1, width: .4, height: .2 } })) } })
}

async function seedExperience(page: Page, expIdleSec = 5) {
  await page.addInitScript(({ key, settings }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings }))
  }, { key: SETTINGS_KEY, settings: {
    ...DEFAULT_SETTINGS, expIdleSec,
    monitors: DEFAULT_SETTINGS.monitors.map(monitor => ({ ...monitor, enabled: monitor.kind === 'exp', roi: monitor.kind === 'exp' ? { x: .1, y: .1, width: .4, height: .2 } : null })),
  } })
}

/** A generated green EXP bar is an integration fixture, not a game screenshot. */
async function drawExperience(page: Page, text: string, animateBar = false) {
  await page.evaluate(({ text, animate }) => {
    if (window.__experienceAnimation !== undefined) clearInterval(window.__experienceAnimation)
    const capture = window.__capture!
    const context = capture.canvas.getContext('2d')!
    let phase = 0
    const draw = () => {
      context.fillStyle = '#111111'
      context.fillRect(0, 0, 1280, 720)
      context.fillStyle = '#4f9d32'
      context.fillRect(128, 72, 512, 144)
      context.fillStyle = phase % 2 ? '#77ad43' : '#638f3b'
      context.fillRect(128, 72, 512 * ((phase % 5) + 1) / 5, 144)
      context.fillStyle = '#fffefb'
      context.font = '22px monospace'
      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.fillText(text, 142, 144)
      capture.track.requestFrame?.()
      phase++
    }
    draw()
    if (animate) window.__experienceAnimation = window.setInterval(draw, 220)
  }, { text, animate: animateBar })
}

const experienceMessage = '경험치 숫자가 5초 동안 변하지 않았습니다.'
const experienceLog = (page: Page) => page.locator('.activity-row').filter({ hasText: experienceMessage })

async function beginCapture(page: Page) {
  await page.getByRole('button', { name: '화면 공유 시작', exact: true }).click()
  await expect(page.getByText('화면 공유 중', { exact: true })).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
}

async function changeFrame(page: Page, color = '#ffffff') {
  await page.evaluate(color => {
    const capture = window.__capture!
    const context = capture.canvas.getContext('2d')!
    context.fillStyle = color; context.fillRect(0, 0, 1280, 720)
    capture.track.requestFrame?.()
  }, color)
}


/** Deliberately synthetic fixtures exercise the pipeline, not game-screenshot accuracy. */
async function drawRuneFixture(page: Page, kind: 'diamond' | 'outside' | 'square' | 'circle' | 'annotation') {
  await page.evaluate(kind => {
    const capture = window.__capture!
    const context = capture.canvas.getContext('2d')!
    context.fillStyle = '#111111'
    context.fillRect(0, 0, capture.canvas.width, capture.canvas.height)
    if (kind === 'annotation') {
      context.strokeStyle = '#ff2020'; context.lineWidth = 3
      context.strokeRect(190, 100, 90, 70)
    } else {
      const centerX = kind === 'outside' ? 900 : 260
      const centerY = kind === 'outside' ? 400 : 140
      for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
        const distance = kind === 'square' ? Math.max(Math.abs(x), Math.abs(y)) : kind === 'circle' ? Math.sqrt(x * x + y * y) : Math.abs(x) + Math.abs(y)
        if (distance > 8) continue
        context.fillStyle = distance >= 7 ? '#d64adb' : distance >= 6 ? '#f5f5fb' : '#2adde7'
        context.fillRect(centerX + x, centerY + y, 1, 1)
      }
    }
    capture.track.requestFrame?.()
  }, kind)
}

const runeMessage = '룬 아이콘 후보가 감지되었습니다. 미니맵을 확인해 주세요.'
const runeLog = (page: Page) => page.locator('.activity-row').filter({ hasText: runeMessage })

test('opens the real sharing workspace without demo controls or invented timers', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '사냥에만 집중하세요.' })).toBeVisible()
  await expect(page.getByRole('button', { name: '화면 공유 시작', exact: true })).toBeVisible()
  await expect(page.getByText(/데모|가상/)).toHaveCount(0)
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('대기')
  await expect(card(page, '경험치 변화').locator('.timer-digits')).toHaveText('--:--')
  await page.waitForTimeout(1100)
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('대기')
  await expect(page.getByRole('button', { name: '데모 일시정지', exact: true })).toHaveCount(0)
})

test('draws source-relative ROI on a real stream, moves it by keyboard, and persists across reload', async ({ page }) => {
  await mockCapture(page)
  await page.goto('/')
  await beginCapture(page)
  await page.locator('.roi-chips').getByRole('button', { name: '룬', exact: true }).click()
  const stage = page.getByRole('group', { name: /룬 인식 영역 편집/ })
  const box = (await stage.boundingBox())!
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .65, { steps: 8 })
  await page.mouse.up()
  const roi = (await stored(page)).monitors.find((m: { id: string }) => m.id === 'rune').roi
  expect(roi.x).toBeCloseTo(.2, 2)
  expect(roi.y).toBeCloseTo(.25, 2)
  expect(roi.width).toBeCloseTo(.4, 2)
  expect(roi.height).toBeCloseTo(.4, 2)
  await stage.press('ArrowRight')
  expect((await stored(page)).monitors[0].roi.x).toBeCloseTo(.21, 2)
  await page.reload()
  await expect(card(page, '룬').getByRole('button', { name: '인식 영역 설정됨' })).toBeVisible()
  expect((await stored(page)).monitors[0].roi.width).toBeCloseTo(.4, 2)
  await beginCapture(page)
  await expect(page.locator('.roi-region')).toHaveCount(1)
})

test('independent module toggles survive reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('switch', { name: '룬 활성화', exact: true }).click()
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('OFF')
  await expect(page.getByRole('switch', { name: '경험치 변화 활성화', exact: true })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: '룬 활성화', exact: true })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: '경험치 변화 활성화', exact: true })).toBeChecked()
})

test('adds, configures, and removes a custom buff without synthetic detection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '새 버프 추가', exact: true }).click()
  await page.getByRole('textbox', { name: '버프 이름', exact: true }).fill('테스트 버프')
  const buff = card(page, '테스트 버프')
  await buff.getByRole('spinbutton', { name: '지속 시간 (초)', exact: true }).fill('120')
  await buff.getByRole('spinbutton', { name: '미리 알림 (초)', exact: true }).fill('15')
  await expect(buff.locator('.timer-digits')).toHaveText('--:--')
  await expect(page.getByRole('button', { name: '가상 감지', exact: true })).toHaveCount(0)
  await page.reload()
  await buff.getByRole('button', { name: '테스트 버프', exact: true }).click()
  await expect(buff.getByRole('spinbutton', { name: '지속 시간 (초)', exact: true })).toHaveValue('120')
  await buff.getByRole('button', { name: '테스트 버프 삭제', exact: true }).click()
  await expect(card(page, '테스트 버프')).toHaveCount(0)
  await page.reload()
  await expect(card(page, '테스트 버프')).toHaveCount(0)
})

test('prefers a Korean female voice and preserves voice, speed, volume, and mute choices', async ({ page }) => {
  await mockSpeech(page)
  await page.goto('/')
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '나에게 맞는 알림' })
  await expect(dialog.getByRole('combobox', { name: '알림 방식', exact: true })).toHaveValue('speech')
  await dialog.getByRole('slider', { name: '알림 음량', exact: true }).fill('0.24')
  await dialog.getByRole('slider', { name: '말하기 속도', exact: true }).fill('0.9')
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(1)
  expect(await page.evaluate(() => window.__spoken![0])).toMatchObject({ voiceURI: 'uri-sunhi', volume: .24, rate: .9 })
  await dialog.getByRole('combobox', { name: '알림 음성', exact: true }).selectOption('uri-injoon')
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(2)
  expect(await page.evaluate(() => window.__spoken![1].voiceURI)).toBe('uri-injoon')
  await dialog.getByRole('switch', { name: '소리 알림 활성화', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  await expect(dialog.getByRole('switch', { name: '소리 알림 활성화', exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('slider', { name: '알림 음량', exact: true })).toHaveValue('0.24')
  await expect(dialog.getByRole('slider', { name: '말하기 속도', exact: true })).toHaveValue('0.9')
  await expect(dialog.getByRole('combobox', { name: '알림 음성', exact: true })).toHaveValue('uri-injoon')
  expect(await stored(page)).toMatchObject({ volume: .24, speechRate: .9, voiceURI: 'uri-injoon', soundEnabled: false })
})

test('refreshes the voice list after delayed browser voice discovery', async ({ page }) => {
  await mockSpeech(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('option', { name: /Microsoft SunHi/ })).toHaveCount(0)
  await page.evaluate(() => window.__loadSpeechVoices!())
  await expect(dialog.getByRole('option', { name: /Microsoft SunHi/ })).toHaveCount(1)
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(1)
  expect(await page.evaluate(() => window.__spoken![0].voiceURI)).toBe('uri-sunhi')
})

test('missing Korean voices fall back to a usable chime without changing the saved speech choice', async ({ page }) => {
  await mockSpeech(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '나에게 맞는 알림' })
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('사용 가능한 한국어 음성이 없습니다.')
  await expect(dialog.getByText('소리 사용 준비 완료', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '알림 소리 테스트', exact: true })).toBeEnabled()
  await expect(page.locator('.audio-dock').getByRole('button', { name: '소리 끄기', exact: true })).toContainText('기본 알림음')
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(0)
  expect((await stored(page)).notificationSound).toBe('speech')
})

test('stalled speech falls back after its watchdog and muting cancels a later pending timeout', async ({ page }) => {
  await mockSpeech(page, false, true)
  await page.goto('/')
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '나에게 맞는 알림' })
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '음성 재생 대기 중…', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(1)
  const cancelBeforeWatchdog = await page.evaluate(() => window.__cancelCount!)
  await expect(dialog.getByRole('status')).toContainText('음성 알림이 시작되지 않았습니다.', { timeout: 12_000 })
  await expect(dialog.getByRole('button', { name: '알림 소리 테스트', exact: true })).toBeEnabled()
  await expect(dialog.getByText('소리 사용 준비 완료', { exact: true })).toBeVisible()
  await expect(page.locator('.audio-dock').getByRole('button', { name: '소리 끄기', exact: true })).toContainText('기본 알림음')
  expect(await page.evaluate(() => window.__cancelCount!)).toBeGreaterThan(cancelBeforeWatchdog)

  // Voice discovery clears the old error; a later cancelled request must not revive it.
  await page.evaluate(() => window.__loadSpeechVoices!())
  await expect(dialog.getByRole('status')).toHaveCount(0)
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '음성 재생 대기 중…', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(2)
  await dialog.getByRole('switch', { name: '소리 알림 활성화', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '알림 소리 테스트', exact: true })).toBeEnabled()
  const cancelAfterMute = await page.evaluate(() => window.__cancelCount!)
  await page.waitForTimeout(8500)
  await expect(dialog.getByRole('status')).toHaveCount(0)
  await expect(page.locator('.audio-dock').getByRole('button', { name: '소리 켜기', exact: true })).toContainText('음소거')
  expect(await page.evaluate(() => window.__cancelCount!)).toBe(cancelAfterMute)
  expect((await stored(page)).soundEnabled).toBe(false)
})

test('shows a real local canvas stream without pretending to recognize icons, and handles browser stop', async ({ page }) => {
  const requests: { method: string; url: string; body: string | null }[] = []
  page.on('request', request => requests.push({ method: request.method(), url: request.url(), body: request.postData() }))
  await mockCapture(page)
  await seedRegions(page)
  await page.goto('/')
  await beginCapture(page)
  expect(await page.evaluate(() => window.__captureOptions)).toEqual({ audio: false, video: { frameRate: { ideal: 10, max: 15 } } })
  await expect(card(page, '룬').getByText('아이콘 감시 중', { exact: true })).toBeVisible()
  await expect(card(page, '경험치 쿠폰').getByText('샘플 필요', { exact: true })).toBeVisible()
  await expect(card(page, '경험치 변화').locator('.timer-digits')).toHaveText('OFF')
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('감시 중')
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).videoWidth)).toBe(1280)
  await page.evaluate(() => {
    const capture = window.__capture!
    capture.track.stop()
    capture.track.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByText('공유 종료됨', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '화면 공유 시작', exact: true })).toBeVisible()
  await expect(page.locator('video')).toHaveJSProperty('srcObject', null)
  expect(requests.filter(request => request.method !== 'GET' || request.body !== null || new URL(request.url).hostname !== '127.0.0.1')).toEqual([])
})

test('actual WASM OCR reads exact large EXP values, ignores bar animation, and pauses on unreadable text', async ({ page }) => {
  test.setTimeout(70_000)
  const requests: { method: string; url: string; body: string | null }[] = []
  page.on('request', request => requests.push({ method: request.method(), url: request.url(), body: request.postData() }))
  await mockCapture(page)
  await mockSpeech(page)
  await seedExperience(page)
  await page.goto('/')
  await page.getByRole('button', { name: '소리 알림 활성화', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(1)
  await beginCapture(page)
  const exp = card(page, '경험치 변화')
  await drawExperience(page, '9,007,199,254,740,992 [67.391%]', true)
  await expect(exp.getByTestId('experience-value')).toHaveText('9,007,199,254,740,992', { timeout: 25_000 })
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
  // The background keeps changing while the number remains identical.
  await expect(exp.getByText('알림 발생', { exact: true })).toBeVisible({ timeout: 9000 })
  await expect(experienceLog(page)).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(2)
  expect(await page.evaluate(() => window.__spoken![1])).toMatchObject({ text: experienceMessage, voiceURI: 'uri-sunhi' })
  await page.waitForTimeout(1200)
  await expect(experienceLog(page)).toHaveCount(1)

  // These integers differ by one beyond Number.MAX_SAFE_INTEGER.
  await drawExperience(page, '9,007,199,254,740,993 [67.391%]', true)
  await expect(exp.getByTestId('experience-value')).toHaveText('9,007,199,254,740,993', { timeout: 12_000 })
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
  await drawExperience(page, '')
  await expect(exp.locator('.tiny-status')).toContainText('인식 실패', { timeout: 9000 })
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
  await page.getByRole('button', { name: '기록 지우기', exact: true }).click()
  await page.waitForTimeout(6000)
  await expect(experienceLog(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(2)

  await drawExperience(page, '9,007,199,254,740,993 [67.391%]')
  await expect(exp.locator('.tiny-status')).toContainText('숫자 감시 중', { timeout: 12_000 })
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
  await page.getByRole('button', { name: '공유 종료', exact: true }).click()
  await expect(page.getByText('공유 종료됨', { exact: true })).toBeVisible()
  await page.waitForTimeout(6000)
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
  await expect(experienceLog(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(2)
  expect(requests.some(request => request.url.includes('/ocr/worker.min.js'))).toBe(true)
  expect(requests.some(request => request.url.includes('/ocr/eng.traineddata.gz'))).toBe(true)
  expect(requests.filter(request => request.method !== 'GET' || request.body !== null || (/^https?:/.test(request.url) && new URL(request.url).hostname !== '127.0.0.1'))).toEqual([])
})

test('numeric EXP inactivity stays visible without speaking before user audio activation', async ({ page }) => {
  test.setTimeout(45_000)
  await mockCapture(page)
  await mockSpeech(page)
  await seedExperience(page)
  await page.goto('/')
  await beginCapture(page)
  await drawExperience(page, '586,571,406,212,585 [67.391%]')
  const exp = card(page, '경험치 변화')
  await expect(exp.getByTestId('experience-value')).toHaveText('586,571,406,212,585', { timeout: 25_000 })
  await expect(exp.getByText('알림 발생', { exact: true })).toBeVisible({ timeout: 9000 })
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(0)
})

test('muted numeric EXP monitoring keeps visible alerts without speech', async ({ page }) => {
  test.setTimeout(45_000)
  await mockCapture(page)
  await mockSpeech(page)
  await seedExperience(page)
  await page.goto('/')
  await page.getByRole('button', { name: '소리 알림 활성화', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(1)
  await page.getByRole('button', { name: '소리 끄기', exact: true }).click()
  await beginCapture(page)
  await drawExperience(page, '586,571,406,212,585 [67.391%]')
  const exp = card(page, '경험치 변화')
  await expect(exp.getByTestId('experience-value')).toHaveText('586,571,406,212,585', { timeout: 25_000 })
  await expect(exp.getByText('알림 발생', { exact: true })).toBeVisible({ timeout: 9000 })
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(1)
})

test('EXP crop analysis failures stay explicit and never become inactivity alarms', async ({ page }) => {
  await mockCapture(page)
  await seedExperience(page)
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function (this: HTMLCanvasElement, ...args: unknown[]) {
      const context = Reflect.apply(getContext, this, args)
      if (args[0] === '2d' && context) {
        context.getImageData = () => { throw new DOMException('EXP frame read blocked', 'SecurityError') }
      }
      return context
    } })
  })
  await page.goto('/')
  await beginCapture(page)
  const exp = card(page, '경험치 변화')
  await expect(exp.locator('.tiny-status')).toContainText('인식 실패', { timeout: 12_000 })
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
  await page.waitForTimeout(6000)
  await expect(experienceLog(page)).toHaveCount(0)
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
})

test('permission denial produces a clear recoverable message', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError') } }))
  await page.goto('/')
  await page.getByRole('button', { name: '화면 공유 시작', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('공유가 취소되었거나 권한이 허용되지 않았습니다')
  await expect(page.getByRole('button', { name: '화면 공유 시작', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '공유 오류 닫기', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('settings modal traps focus, closes by Escape, and restores the trigger', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '알림 설정 열기', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeFocused()
  await dialog.getByRole('button', { name: '완료', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '창 닫기', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '완료', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('light theme uses readable type without desktop or mobile horizontal overflow', async ({ page }) => {
  await page.goto('/')
  const colors = await page.evaluate(() => ({ background: getComputedStyle(document.documentElement).backgroundColor, bodySize: parseFloat(getComputedStyle(document.body).fontSize) }))
  const channels = colors.background.match(/\d+/g)!.map(Number)
  expect(channels.slice(0, 3).every(value => value >= 240)).toBe(true)
  expect(colors.bodySize).toBeGreaterThanOrEqual(15)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '사냥에만 집중하세요.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})


test('Rune synthetic diamond emits one Korean speech alert and rearms after absence and cooldown', async ({ page }) => {
  await mockCapture(page)
  await mockSpeech(page)
  await seedRegions(page)
  await page.goto('/')
  await page.getByRole('button', { name: '소리 알림 활성화', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(1)
  await beginCapture(page)
  const rune = card(page, '룬')
  await expect(rune.locator('.timer-digits')).toHaveText('감시 중')
  await drawRuneFixture(page, 'diamond')
  await expect(rune.locator('.timer-digits')).toHaveText('발견')
  const firstDetection = Date.now()
  await expect(rune.getByText('룬 후보 감지', { exact: true })).toBeVisible()
  await expect(runeLog(page)).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(2)
  expect(await page.evaluate(() => window.__spoken![1])).toMatchObject({ text: runeMessage, voiceURI: 'uri-sunhi' })
  await page.waitForTimeout(1250)
  await expect(runeLog(page)).toHaveCount(1)
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(2)
  await changeFrame(page, '#111111')
  await expect(rune.locator('.timer-digits')).toHaveText('감시 중', { timeout: 4500 })
  await page.waitForTimeout(Math.max(0, 10_500 - (Date.now() - firstDetection)))
  await drawRuneFixture(page, 'diamond')
  await expect(runeLog(page)).toHaveCount(2)
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(3)
  await page.getByRole('button', { name: '공유 종료', exact: true }).click()
  await expect(rune.locator('.timer-digits')).toHaveText('대기')
})

test('Rune ignores out-of-ROI icons, solid squares, circles, and red annotation rectangles', async ({ page }) => {
  await mockCapture(page)
  await mockSpeech(page)
  await seedRegions(page)
  await page.goto('/')
  await beginCapture(page)
  const rune = card(page, '룬')
  await expect(rune.locator('.timer-digits')).toHaveText('감시 중')
  for (const kind of ['outside', 'square', 'circle', 'annotation'] as const) {
    await drawRuneFixture(page, kind)
    await page.waitForTimeout(1300)
    await expect(runeLog(page)).toHaveCount(0)
    await expect(rune.locator('.timer-digits')).toHaveText('감시 중')
  }
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(0)
})

test('Rune toggle stops detection and mute preserves only visible synthetic-icon alerts', async ({ page }) => {
  await mockCapture(page)
  await mockSpeech(page)
  await seedRegions(page)
  await page.goto('/')
  await page.getByRole('button', { name: '소리 알림 활성화', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken!.length)).toBe(1)
  await page.getByRole('switch', { name: '룬 활성화', exact: true }).click()
  await beginCapture(page)
  await drawRuneFixture(page, 'diamond')
  await page.waitForTimeout(1300)
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('OFF')
  await expect(runeLog(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(1)
  await page.getByRole('button', { name: '소리 끄기', exact: true }).click()
  await page.getByRole('switch', { name: '룬 활성화', exact: true }).click()
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('발견')
  await expect(runeLog(page)).toHaveCount(1)
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(1)
})

test('Rune analysis failure is explicit and never treated as a detected icon', async ({ page }) => {
  await mockCapture(page)
  await mockSpeech(page)
  await seedRegions(page)
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function (this: HTMLCanvasElement, ...args: unknown[]) {
      const context = Reflect.apply(getContext, this, args)
      if (args[0] === '2d' && context) {
        context.getImageData = () => { throw new DOMException('Rune frame read blocked', 'SecurityError') }
      }
      return context
    } })
  })
  await page.goto('/')
  await beginCapture(page)
  const rune = card(page, '룬')
  await expect(rune.locator('.tiny-status')).toContainText('실패')
  await expect(runeLog(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__spoken!.length)).toBe(0)
  await page.getByRole('button', { name: '공유 종료', exact: true }).click()
  await expect(rune.locator('.timer-digits')).toHaveText('대기')
})

test('Rune icon size and matching threshold persist without changing other modules', async ({ page }) => {
  await page.goto('/')
  const before = await stored(page)
  const rune = card(page, '룬')
  await rune.getByRole('button', { name: '룬', exact: true }).click()
  await rune.getByRole('spinbutton', { name: '아이콘 최소 크기 (px)', exact: true }).fill('9')
  await rune.getByRole('spinbutton', { name: '아이콘 최대 크기 (px)', exact: true }).fill('28')
  await rune.getByRole('slider', { name: '일치 기준 (점)', exact: true }).fill('82')
  expect((await stored(page)).runeDetection).toMatchObject({ minSize: 9, maxSize: 28, minScore: .82 })
  await page.reload()
  await rune.getByRole('button', { name: '룬', exact: true }).click()
  await expect(rune.getByRole('spinbutton', { name: '아이콘 최소 크기 (px)', exact: true })).toHaveValue('9')
  await expect(rune.getByRole('spinbutton', { name: '아이콘 최대 크기 (px)', exact: true })).toHaveValue('28')
  await expect(rune.getByRole('slider', { name: '일치 기준 (점)', exact: true })).toHaveValue('82')
  const after = await stored(page)
  expect(after.monitors).toEqual(before.monitors)
  expect(after.volume).toBe(before.volume)
  expect(after.voiceURI).toBe(before.voiceURI)
})

test('Rune reappearance during cooldown does not repeat the previous icon alert', async ({ page }) => {
  await mockCapture(page)
  await seedRegions(page)
  await page.goto('/')
  await beginCapture(page)
  await drawRuneFixture(page, 'diamond')
  await expect(runeLog(page)).toHaveCount(1)
  await changeFrame(page, '#111111')
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('감시 중', { timeout: 4500 })
  await drawRuneFixture(page, 'diamond')
  await page.waitForTimeout(1300)
  await expect(runeLog(page)).toHaveCount(1)
})


test('changing EXP ROI during an actual OCR job ignores the old result and allows a clean retry', async ({ page }) => {
  test.setTimeout(60_000)
  await mockCapture(page)
  await seedExperience(page)
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage
    window.__ocrRecognizePosts = 0
    Object.defineProperty(Worker.prototype, 'postMessage', { value: function (this: Worker, message: unknown, ...transfer: unknown[]) {
      if (typeof message === 'object' && message !== null && 'action' in message && message.action === 'recognize') {
        window.__ocrRecognizePosts! += 1
        // Delay delivery only: the unmodified local WASM engine still recognizes the frame.
        window.setTimeout(() => { Reflect.apply(postMessage, this, [message, ...transfer]) }, 1200)
        return
      }
      return Reflect.apply(postMessage, this, [message, ...transfer])
    } })
  })
  await page.goto('/')
  await beginCapture(page)
  await drawExperience(page, '9,007,199,254,740,992 [67.391%]')
  await expect.poll(() => page.evaluate(() => window.__ocrRecognizePosts!), { timeout: 25_000 }).toBeGreaterThan(0)
  await page.locator('.roi-chips').getByRole('button', { name: '경험치 변화', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'ROI x (%)', exact: true }).fill('60')
  const exp = card(page, '경험치 변화')
  await expect(exp.getByTestId('experience-value')).toHaveText('--')
  await expect(exp.locator('.tiny-status')).toContainText('인식 실패', { timeout: 12_000 })
  await expect(exp.getByTestId('experience-value')).toHaveText('--')
  await expect(experienceLog(page)).toHaveCount(0)

  await page.getByRole('spinbutton', { name: 'ROI x (%)', exact: true }).fill('10')
  await exp.getByRole('button', { name: '경험치 변화', exact: true }).click()
  await exp.getByRole('button', { name: '숫자 인식 다시 시작', exact: true }).click()
  await expect(exp.getByTestId('experience-value')).toHaveText('9,007,199,254,740,992', { timeout: 25_000 })
  await expect(exp.locator('.tiny-status')).toContainText('숫자 감시 중')
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
})

test('fatal OCR worker failure stays actionable after ROI edits and a new reader can recover', async ({ page }) => {
  test.setTimeout(60_000)
  await mockCapture(page)
  await seedExperience(page)
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage
    let failFirstRecognition = true
    Object.defineProperty(Worker.prototype, 'postMessage', { value: function (this: Worker, message: unknown, ...transfer: unknown[]) {
      if (typeof message === 'object' && message !== null && 'action' in message && message.action === 'recognize' && failFirstRecognition) {
        failFirstRecognition = false
        throw new Error('Injected OCR worker transport failure')
      }
      return Reflect.apply(postMessage, this, [message, ...transfer])
    } })
  })
  await page.goto('/')
  await beginCapture(page)
  await drawExperience(page, '586,571,406,212,585 [67.391%]')
  const exp = card(page, '경험치 변화')
  await expect(exp.locator('.tiny-status')).toContainText('인식 실패', { timeout: 25_000 })
  await exp.getByRole('button', { name: '경험치 변화', exact: true }).click()
  const retry = exp.getByRole('button', { name: '숫자 인식 다시 시작', exact: true })
  await expect(retry).toBeEnabled()
  await page.locator('.roi-chips').getByRole('button', { name: '경험치 변화', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'ROI y (%)', exact: true }).fill('11')
  await expect(exp.locator('.tiny-status')).toContainText('인식 실패')
  await expect(retry).toBeEnabled()
  await expect(exp.getByText('숫자 인식 모델 준비 중입니다. 처음 사용할 때는 잠시 걸릴 수 있어요.', { exact: true })).toHaveCount(0)
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
  await expect(experienceLog(page)).toHaveCount(0)
  await retry.click()
  await expect(exp.getByTestId('experience-value')).toHaveText('586,571,406,212,585', { timeout: 25_000 })
  await expect(exp.locator('.tiny-status')).toContainText('숫자 감시 중')
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
})
