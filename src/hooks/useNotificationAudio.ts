import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveMonitorAudio } from '../lib/monitorAudio';
import type { Monitor, Settings } from '../types';
import { getKoreanVoices, SpeechNotifier } from '../lib/speech';

export function useNotificationAudio(settings: Settings, notify: (message: string) => void) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [audioReady, setAudioReady] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [testing, setTesting] = useState(false);
  const speechRef = useRef<SpeechNotifier | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const outputRef = useRef<DynamicsCompressorNode | null>(null);
  const unlocked = useRef(false);
  const audioEpoch = useRef(0);
  const oscillators = useRef(new Set<OscillatorNode>());
  const mounted = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const stop = useCallback(() => {
    audioEpoch.current++;
    speechRef.current?.stop();
    oscillators.current.forEach(oscillator => { try { oscillator.stop(); } catch { /* Already ended. */ } });
    oscillators.current.clear();
    setTesting(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const synthesis = typeof window.speechSynthesis === 'undefined' ? null : window.speechSynthesis;
    const updateVoices = () => {
      try {
        const available = getKoreanVoices(synthesis?.getVoices() ?? []);
        setVoices(available);
        if (available.length) setVoiceError('');
      } catch {
        setVoices([]);
        setVoiceError('기기의 음성 목록을 불러오지 못했습니다. 기본 알림음을 사용해 주세요.');
      }
    };
    updateVoices();
    synthesis?.addEventListener('voiceschanged', updateVoices);
    // Some browsers populate the voice list late without dispatching an initial event.
    const retry = window.setTimeout(updateVoices, 1200);
    return () => {
      mounted.current = false;
      clearTimeout(retry);
      synthesis?.removeEventListener('voiceschanged', updateVoices);
      audioEpoch.current++;
      oscillators.current.forEach(oscillator => { try { oscillator.stop(); } catch { /* Already ended. */ } });
      oscillators.current.clear();
      speechRef.current?.stop();
      speechRef.current = null;
      void contextRef.current?.close();
      contextRef.current = null;
      outputRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!settings.soundEnabled) stop();
  }, [settings.soundEnabled, stop]);
  useEffect(() => { stop(); }, [settings.notificationSound, settings.voiceURI, stop]);

  const chime = useCallback(async (kind: 'chime' | 'dingdong' = 'chime', volume = settingsRef.current.volume) => {
    const epoch = audioEpoch.current;
    try {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      await context.resume();
      if (!mounted.current || epoch !== audioEpoch.current || context.state !== 'running') return false;
      unlocked.current = true;
      setAudioReady(true);
      if (volume === 0) return true;
      // Share headroom between overlapping alert tones at the louder level.
      if (!outputRef.current) {
        const output = context.createDynamicsCompressor();
        output.threshold.value = -3; output.knee.value = 3; output.ratio.value = 12;
        output.attack.value = .002; output.release.value = .15;
        output.connect(context.destination); outputRef.current = output;
      }
      const output = outputRef.current;
      const start = context.currentTime;
      const frequencies = kind === 'dingdong' ? [880, 659.25] : [659.25, 880, 987.77];
      frequencies.forEach((frequency, index) => {
        const at = start + index * (kind === 'dingdong' ? .34 : .16);
        const duration = kind === 'dingdong' ? .65 : .25;
        const partials = kind === 'dingdong' ? [1, 2] : [1];
        partials.forEach(partial => {
          const oscillator = context.createOscillator(), gain = context.createGain();
          oscillator.type = 'sine'; oscillator.frequency.value = frequency * partial;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(Math.max(.0001, volume * (partial === 1 ? .55 : .11)), at + .012);
          gain.gain.exponentialRampToValueAtTime(.0001, at + duration - .01);
          oscillator.connect(gain); gain.connect(output);
          oscillators.current.add(oscillator);
          oscillator.start(at); oscillator.stop(at + duration);
          oscillator.onended = () => { oscillators.current.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        });
      });
      return true;
    } catch {
      if (mounted.current) notify('알림음을 재생할 수 없습니다. 브라우저의 소리 권한을 확인해 주세요.');
      return false;
    }
  }, [notify]);

  const speak = useCallback(async (message: string, force = false, monitor?: Monitor) => {
    const current = settingsRef.current;
    if (!force && (!current.soundEnabled || !unlocked.current)) return false;
    const profile = resolveMonitorAudio(current, message, monitor);
    if (profile.sound === 'silent') return false;
    if (profile.sound === 'chime' || profile.sound === 'dingdong') return chime(profile.sound, profile.volume);
    const epoch = audioEpoch.current;
    speechRef.current ??= new SpeechNotifier();
    let fallback: Promise<boolean> | null = null;
    const useFallback = (reason: string) => {
      if (!mounted.current || epoch !== audioEpoch.current) return;
      setTesting(false);
      setVoiceError(reason);
      if (!force && !settingsRef.current.soundEnabled) return;
      fallback ??= chime('chime', profile.volume);
    };
    const accepted = speechRef.current.say(profile.text, {
      volume: profile.volume,
      rate: current.speechRate,
      voiceURI: profile.voiceURI,
      onStart: () => {
        if (!mounted.current) return;
        unlocked.current = true;
        setAudioReady(true);
        setTesting(false);
        setVoiceError('');
      },
      onEnd: () => { if (mounted.current) setTesting(false); },
      onError: useFallback,
    });
    if (!accepted) {
      if (!fallback) useFallback('한국어 음성을 사용할 수 없어 기본 알림음을 사용합니다.');
      return fallback ? await fallback : false;
    }
    return true;
  }, [chime]);

  const preview = useCallback(async (monitor?: Monitor) => {
    stop();
    setTesting(true);
    const message = monitor ? `${monitor.name} 알림입니다.` : '알림 음성을 확인합니다. 경험치 영역에 변화가 없으면 알려드릴게요.';
    const result = await speak(message, true, monitor);
    if (!result || resolveMonitorAudio(settingsRef.current, message, monitor).sound !== 'speech') setTesting(false);
    return result;
  }, [speak, stop]);

  const speakAlert = useCallback((message: string, monitor?: Monitor) => speak(message, false, monitor), [speak]);
  return { voices, audioReady, voiceError, testing, preview, speakAlert, stop };
}
