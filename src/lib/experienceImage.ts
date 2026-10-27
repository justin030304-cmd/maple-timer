import type { PixelFrame } from './analysis'

const MAX_SOURCE_WIDTH = 4096
const MAX_SOURCE_HEIGHT = 256
const MAX_OUTPUT_WIDTH = 2400
const MAX_OUTPUT_HEIGHT = 400
const PADDING = 12

/** Prepare the white/off-white EXP numerals, not the green bar itself, for OCR.
 * It deliberately throws for empty, obscured or overly broad crops instead of
 * turning such a frame into an apparently unchanged experience reading. */
export function prepareExperienceImage(frame: PixelFrame, options: { preserveAntialias?: boolean } = {}): PixelFrame {
  const { width, height, data } = frame
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || data.length !== width * height * 4) {
    throw new Error('경험치 숫자 영역의 이미지가 유효하지 않습니다.')
  }
  if (width > MAX_SOURCE_WIDTH || height > MAX_SOURCE_HEIGHT) {
    throw new Error('경험치 인식 영역이 너무 큽니다. 하단 연두색 바의 숫자 부분만 좁게 지정해 주세요.')
  }

  const pixels = width * height
  const luminance = new Uint8Array(pixels)
  let brightest = 0
  for (let index = 0; index < pixels; index++) {
    const offset = index * 4
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2]
    const low = Math.min(red, green, blue), high = Math.max(red, green, blue)
    // White/yellowish antialiased glyphs survive; even a bright lime bar has a
    // low blue channel and large channel spread, so it does not become text.
    if (data[offset + 3] < 160 || low < 130 || high - low > 90) continue
    const level = Math.round((red * 299 + green * 587 + blue * 114) / 1000)
    luminance[index] = level
    brightest = Math.max(brightest, level)
  }
  if (brightest < 150) throw new Error('경험치 숫자를 찾지 못했습니다. 밝은 숫자와 약간의 여백을 포함하도록 영역을 다시 지정해 주세요.')

  // Dim grey/off-white text should work too; colored background brightness
  // cannot change this threshold because saturated colors were excluded above.
  const threshold = Math.max(150, Math.min(175, brightest - 30))
  const mask = new Uint8Array(pixels)
  const discarded = new Uint8Array(pixels)
  for (let index = 0; index < pixels; index++) mask[index] = Number(luminance[index] >= threshold)

  // A thin border of the EXP bar is not a glyph. Remove very long continuous
  // rules, keeping separated digit strokes and one-pixel punctuation intact.
  const horizontalLimit = Math.max(40, Math.ceil(width * .7))
  for (let y = 0; y < height; y++) {
    let start = -1
    for (let x = 0; x <= width; x++) {
      if (x < width && mask[y * width + x]) {
        if (start < 0) start = x
      } else if (start >= 0) {
        if (x - start >= horizontalLimit) {
          mask.fill(0, y * width + start, y * width + x)
          discarded.fill(1, y * width + start, y * width + x)
        }
        start = -1
      }
    }
  }
  // Restrict vertical border removal to the outer columns of a wide crop, so
  // a narrow numeral such as 1 in the actual numeric line is preserved.
  if (width >= 64) {
    const verticalLimit = Math.max(10, Math.ceil(height * .8))
    for (const x of [0, 1, width - 2, width - 1]) {
      let start = -1
      for (let y = 0; y <= height; y++) {
        if (y < height && mask[y * width + x]) {
          if (start < 0) start = y
        } else if (start >= 0) {
          if (y - start >= verticalLimit) for (let row = start; row < y; row++) {
            mask[row * width + x] = 0
            discarded[row * width + x] = 1
          }
          start = -1
        }
      }
    }
  }

  let grey: Uint8Array | null = null
  if (options.preserveAntialias) {
    // The green or black bar contributes little blue; its mode is a stable
    // background estimate. A glyph's blue contrast preserves antialiased thin
    // strokes which a binary cutoff can erase in very small text.
    const backgroundLevels = new Uint32Array(256)
    const foregroundLevels = new Uint32Array(256)
    let foregroundCount = 0
    for (let index = 0; index < pixels; index++) {
      if (data[index * 4 + 3] < 160) continue
      const blue = data[index * 4 + 2]
      backgroundLevels[blue]++
      if (mask[index]) { foregroundLevels[blue]++; foregroundCount++ }
    }
    let backgroundBlue = 0
    for (let level = 1; level < 256; level++) if (backgroundLevels[level] > backgroundLevels[backgroundBlue]) backgroundBlue = level
    let foregroundBlue = 0, cumulative = 0
    for (; foregroundBlue < 255; foregroundBlue++) {
      cumulative += foregroundLevels[foregroundBlue]
      if (cumulative >= foregroundCount * .8) break
    }
    const contrast = foregroundBlue - backgroundBlue
    if (foregroundCount < 6 || contrast < 40) throw new Error('경험치 숫자와 배경의 대비가 부족합니다. 숫자 부분만 좁게 지정해 주세요.')
    grey = new Uint8Array(pixels)
    for (let index = 0; index < pixels; index++) {
      const offset = index * 4
      const strength = discarded[index] || data[offset + 3] < 160 ? 0 : Math.max(0, Math.min(1, (data[offset + 2] - backgroundBlue) / contrast))
      grey[index] = Math.round(255 * (1 - strength))
      mask[index] = Number(strength >= .14)
    }
  }

  // The grayscale pass can restore dim borders that were below the initial
  // white-text threshold. Remove their antialiased edges AFTER that pass too.
  // Use continuous runs, rather than row density, to preserve separated digits.
  if (grey) {
    for (let y = 0; y < height; y++) {
      let start = -1
      for (let x = 0; x <= width; x++) {
        const index = y * width + x
        if (x < width && grey[index] < 245) {
          if (start < 0) start = x
        } else if (start >= 0) {
          if (x - start >= horizontalLimit) {
            grey.fill(255, y * width + start, y * width + x)
            mask.fill(0, y * width + start, y * width + x)
          }
          start = -1
        }
      }
    }
  }

  let left = width, right = -1, top = height, bottom = -1, ink = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
      ink++
    }
  }
  const cropWidth = right - left + 1, cropHeight = bottom - top + 1
  if (ink < 6 || cropWidth < 2 || cropHeight < 3) {
    throw new Error('경험치 숫자를 찾지 못했습니다. 숫자 부분을 확대하거나 인식 영역을 다시 지정해 주세요.')
  }
  const coverage = ink / (cropWidth * cropHeight)
  if (ink / pixels > .7 || (cropWidth >= cropHeight && coverage > .88)) {
    throw new Error('경험치 숫자 영역이 가려졌거나 너무 밝습니다. 숫자가 보이는 영역을 다시 지정해 주세요.')
  }

  const scale = Math.min(6, Math.max(1, (options.preserveAntialias ? 40 : 96) / cropHeight), (MAX_OUTPUT_WIDTH - PADDING * 2) / cropWidth, (MAX_OUTPUT_HEIGHT - PADDING * 2) / cropHeight)
  const textWidth = Math.max(1, Math.floor(cropWidth * scale))
  const textHeight = Math.max(1, Math.floor(cropHeight * scale))
  const outputWidth = textWidth + PADDING * 2
  const outputHeight = textHeight + PADDING * 2
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4)
  output.fill(255)
  for (let y = 0; y < textHeight; y++) {
    const sourceY = top + Math.min(cropHeight - 1, Math.floor(y / (textHeight / cropHeight)))
    for (let x = 0; x < textWidth; x++) {
      const sourceX = left + Math.min(cropWidth - 1, Math.floor(x / (textWidth / cropWidth)))
      const value = grey ? grey[sourceY * width + sourceX] : mask[sourceY * width + sourceX] ? 0 : 255
      if (value === 255) continue
      const offset = ((y + PADDING) * outputWidth + x + PADDING) * 4
      output[offset] = value; output[offset + 1] = value; output[offset + 2] = value
    }
  }
  return { width: outputWidth, height: outputHeight, data: output }
}
