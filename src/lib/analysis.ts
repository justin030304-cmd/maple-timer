/** Basic pixel-change measurement. This is NOT rune/icon/OCR recognition. */
export interface PixelFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Mean RGB distance in [0,1]. Null means no comparable previous frame. */
export function measureFrameChange(previous: PixelFrame | null, current: PixelFrame): number | null {
  if (current.width < 1 || current.height < 1 || current.data.length !== current.width * current.height * 4) throw new Error('유효하지 않은 프레임입니다')
  if (!previous || previous.width !== current.width || previous.height !== current.height || previous.data.length !== current.data.length) return null
  let difference = 0
  for (let index = 0; index < current.data.length; index += 4) {
    difference += Math.abs(current.data[index] - previous.data[index])
    difference += Math.abs(current.data[index + 1] - previous.data[index + 1])
    difference += Math.abs(current.data[index + 2] - previous.data[index + 2])
  }
  return difference / (current.width * current.height * 3 * 255)
}
