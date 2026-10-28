export type ToneKind = 'chime' | 'dingdong'
const buses = new WeakMap<BaseAudioContext, {compressor:DynamicsCompressorNode; limiter:WaveShaperNode; users:number}>()

/** Local synthesis, with a sustained envelope so alerts stay audible after the attack. */
export function scheduleNotificationTones(context: BaseAudioContext, kind: ToneKind, volume: number, boost: number): OscillatorNode[] {
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0
  const amplification = Number.isFinite(boost) ? Math.max(1, Math.min(4, boost)) : 2
  if (level === 0) return []
  let bus = buses.get(context)
  if (!bus) {
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -2; compressor.knee.value = 2; compressor.ratio.value = 20
    compressor.attack.value = .001; compressor.release.value = .12
    const limiter = context.createWaveShaper(), curve = new Float32Array(4097)
    for (let i=0;i<curve.length;i++) {
      const x=i/(curve.length-1)*2-1, magnitude=Math.abs(x)
      curve[i]=Math.sign(x)*(magnitude<=.8?magnitude:.8+.2*Math.tanh((magnitude-.8)/.2))
    }
    limiter.curve=curve
    compressor.connect(limiter); limiter.connect(context.destination)
    bus={compressor,limiter,users:0};buses.set(context,bus)
  }
  const output=bus;output.users++
  const input = context.createGain(); input.gain.value = amplification; input.connect(output.compressor)
  const frequencies = kind === 'dingdong' ? [880, 659.25] : [659.25, 880, 987.77]
  const start = context.currentTime, oscillators: OscillatorNode[] = []
  let remaining = frequencies.length * (kind === 'dingdong' ? 2 : 1)
  for (const [index, frequency] of frequencies.entries()) {
    const at = start + index * (kind === 'dingdong' ? .4 : .26)
    const duration = kind === 'dingdong' ? .95 : .6
    for (const partial of kind === 'dingdong' ? [1, 2] : [1]) {
      const oscillator = context.createOscillator(), gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = frequency * partial
      const peak = level * (partial === 1 ? .7 : .14)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(peak, at + .015)
      gain.gain.setValueAtTime(peak, at + .14)
      gain.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * .4), at + duration * .65)
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration)
      oscillator.connect(gain); gain.connect(input)
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect()
        if (--remaining === 0) {
          input.disconnect()
          if (--output.users === 0) { output.compressor.disconnect(); output.limiter.disconnect(); buses.delete(context) }
        }
      }
      oscillators.push(oscillator)
      oscillator.start(at); oscillator.stop(at + duration)
    }
  }
  return oscillators
}
