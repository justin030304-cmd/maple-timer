import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/lib/settings'

declare global {
  interface Window {
    __capture?: { canvas: HTMLCanvasElement; stream: MediaStream; track: MediaStreamTrack & { requestFrame?: () => void } }
    __captureOptions?: DisplayMediaStreamOptions
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

async function seedRegions(page: Page, expIdleSec = 5) {
  await page.addInitScript(({ key, settings }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings }))
  }, { key: SETTINGS_KEY, settings: { ...DEFAULT_SETTINGS, expIdleSec, monitors: DEFAULT_SETTINGS.monitors.map(monitor => ({ ...monitor, roi: { x: .1, y: .1, width: .4, height: .2 } })) } })
}

async function beginCapture(page: Page) {
  await page.getByRole('button', { name: '실제 화면', exact: true }).click()
  await page.getByRole('button', { name: '화면 공유 시작', exact: true }).click()
  await expect(page.getByText('화면 공유 중', { exact: true })).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
}

test('demo timers run, pause without advancing, and resume', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '사냥에만 집중하세요.' })).toBeVisible()
  await expect(page.getByText('실제 감지 결과가 아닙니다')).toBeVisible()
  const timer = card(page, '룬').locator('.timer-digits')
  const initial = await timer.innerText()
  await expect.poll(() => timer.innerText()).not.toBe(initial)
  await page.getByRole('button', { name: '데모 일시정지', exact: true }).click()
  const paused = await timer.innerText()
  await page.waitForTimeout(1300)
  await expect(timer).toHaveText(paused)
  await page.getByRole('button', { name: '데모 재생', exact: true }).click()
  await expect.poll(() => timer.innerText()).not.toBe(paused)
})

test('draws source-relative ROI, moves it by keyboard, and persists across reload', async ({ page }) => {
  await page.goto('/')
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
  await expect(page.locator('.roi-region')).toHaveCount(1)
  expect((await stored(page)).monitors[0].roi.width).toBeCloseTo(.4, 2)
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

test('adds, configures, resets, and removes a custom buff', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '새 버프 추가', exact: true }).click()
  await page.getByRole('textbox', { name: '버프 이름', exact: true }).fill('테스트 버프')
  const buff = card(page, '테스트 버프')
  await buff.getByRole('spinbutton', { name: '지속 시간 (초)', exact: true }).fill('120')
  await buff.getByRole('spinbutton', { name: '미리 알림 (초)', exact: true }).fill('15')
  await buff.getByRole('button', { name: '가상 감지', exact: true }).click()
  await expect(buff.locator('.timer-digits')).toHaveText(/0[12]:\d{2}/)
  await page.reload()
  await buff.getByRole('button', { name: '테스트 버프', exact: true }).click()
  await expect(buff.getByRole('spinbutton', { name: '지속 시간 (초)', exact: true })).toHaveValue('120')
  await buff.getByRole('button', { name: '테스트 버프 삭제', exact: true }).click()
  await expect(card(page, '테스트 버프')).toHaveCount(0)
  await page.reload()
  await expect(card(page, '테스트 버프')).toHaveCount(0)
})

test('saves sound preferences and allows an explicit audio test', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '나에게 맞는 알림' })
  await dialog.getByRole('switch', { name: '소리 알림 활성화', exact: true }).click()
  await dialog.getByRole('slider', { name: '알림 음량', exact: true }).fill('0.24')
  await dialog.getByRole('button', { name: '알림 소리 테스트', exact: true }).click()
  await expect(dialog.getByText('소리 사용 준비 완료')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  await expect(dialog.getByRole('switch', { name: '소리 알림 활성화', exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('slider', { name: '알림 음량', exact: true })).toHaveValue('0.24')
  expect((await stored(page)).volume).toBe(.24)
})

test('shows a real local canvas stream without pretending to recognize icons, and handles browser stop', async ({ page }) => {
  const requests: { method: string; url: string; body: string | null }[] = []
  page.on('request', request => requests.push({ method: request.method(), url: request.url(), body: request.postData() }))
  await mockCapture(page)
  await seedRegions(page)
  await page.goto('/')
  await beginCapture(page)
  expect(await page.evaluate(() => window.__captureOptions)).toEqual({ audio: false, video: { frameRate: { ideal: 10, max: 15 } } })
  await expect(card(page, '룬').getByText('샘플 필요', { exact: true })).toBeVisible()
  await expect(card(page, '경험치 쿠폰').getByText('샘플 필요', { exact: true })).toBeVisible()
  await expect(card(page, '경험치 변화').getByText('샘플 필요', { exact: true })).toBeVisible()
  await expect(card(page, '룬').locator('.timer-digits')).toHaveText('--:--')
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

test('experimental pixel inactivity alerts once, resets after a frame change, and stops on sharing stop', async ({ page }) => {
  const uploads: string[] = []
  page.on('request', request => { if (request.method() !== 'GET' || request.postData() !== null) uploads.push(request.url()) })
  await mockCapture(page)
  await seedRegions(page, 5)
  await page.goto('/')
  await beginCapture(page)
  const exp = card(page, '경험치 변화')
  await exp.getByRole('button', { name: '경험치 변화', exact: true }).click()
  await exp.getByRole('checkbox', { name: '실험용 픽셀 변화 감시 켜기', exact: true }).check()
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
  await expect(exp.getByText('알림 발생', { exact: true })).toBeVisible({ timeout: 9000 })
  await expect(page.getByRole('status')).toContainText('[픽셀 감시] 경험치 변화')
  const log = page.locator('.activity-row').filter({ hasText: '[픽셀 감시] 경험치 변화' })
  await expect(log).toHaveCount(1)
  await page.waitForTimeout(1200)
  await expect(log).toHaveCount(1)
  await page.evaluate(() => {
    const capture = window.__capture!
    const context = capture.canvas.getContext('2d')!
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1280, 720)
    capture.track.requestFrame?.()
  })
  await expect(exp.locator('.timer-digits')).toHaveText(/^00:0[1-5]$/)
  await page.getByRole('button', { name: '공유 종료', exact: true }).click()
  await expect(page.getByText('공유 종료됨', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '기록 지우기', exact: true }).click()
  await page.waitForTimeout(6000)
  await expect(log).toHaveCount(0)
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
  expect(uploads).toEqual([])
})

test('canvas analysis failures are visible and do not become successful detections', async ({ page }) => {
  await mockCapture(page)
  await seedRegions(page)
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function (this: HTMLCanvasElement, ...args: unknown[]) {
      const context = Reflect.apply(getContext, this, args)
      if (this.width === 160 && this.height === 40 && args[0] === '2d' && context) {
        context.getImageData = () => { throw new DOMException('Read blocked', 'SecurityError') }
      }
      return context
    } })
  })
  await page.goto('/')
  await beginCapture(page)
  const exp = card(page, '경험치 변화')
  await exp.getByRole('button', { name: '경험치 변화', exact: true }).click()
  await exp.getByRole('checkbox', { name: '실험용 픽셀 변화 감시 켜기', exact: true }).check()
  await expect(exp.getByText('분석 실패', { exact: true })).toBeVisible()
  await expect(exp.getByText('인식 영역의 프레임 분석에 실패했습니다. 영역을 다시 지정하거나 화면을 다시 공유해 주세요.')).toBeVisible()
  await expect(exp.locator('.timer-digits')).toHaveText('--:--')
})

test('permission denial produces a clear recoverable message', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError') } }))
  await page.goto('/')
  await page.getByRole('button', { name: '실제 화면', exact: true }).click()
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

test('mobile dashboard has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '사냥에만 집중하세요.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '알림 설정 열기', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
