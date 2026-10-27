import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../types';
import { getKoreanVoices, SpeechNotifier } from '../lib/speech';

export function useNotificationAudio(settings: Settings, notify: (message: string) => void) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [audioReady, setAudioReady] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [testing, setTesting] = useState(false);
  const speechRef = useRef<SpeechNotifier | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const unlocked = useRef(false);
  const mounted = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const stop = useCallback(() => {
    speechRef.current?.stop();
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
      speechRef.current?.stop();
      speechRef.current = null;
      void contextRef.current?.close();
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!settings.soundEnabled) stop();
  }, [settings.soundEnabled, stop]);
  useEffect(() => { stop(); }, [settings.notificationSound, settings.voiceURI, stop]);

  const chime = useCallback(async () => {
    try {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      await context.resume();
      if (!mounted.current || context.state !== 'running') return false;
      unlocked.current = true;
      setAudioReady(true);
      if (settingsRef.current.volume === 0) return true;
      const start = context.currentTime;
      [659.25, 880, 987.77].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start + index * .16);
        gain.gain.linearRampToValueAtTime(Math.max(.0001, settingsRef.current.volume * .2), start + index * .16 + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, start + index * .16 + .24);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start + index * .16);
        oscillator.stop(start + index * .16 + .25);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
      return true;
    } catch {
      if (mounted.current) notify('알림음을 재생할 수 없습니다. 브라우저의 소리 권한을 확인해 주세요.');
      return false;
    }
  }, [notify]);

  const speak = useCallback(async (message: string, force = false) => {
    const current = settingsRef.current;
    if (!force && (!current.soundEnabled || !unlocked.current)) return false;
    if (current.notificationSound === 'chime') return chime();
    speechRef.current ??= new SpeechNotifier();
    let fallback: Promise<boolean> | null = null;
    const useFallback = (reason: string) => {
      if (!mounted.current) return;
      setTesting(false);
      setVoiceError(reason);
      if (!force && !settingsRef.current.soundEnabled) return;
      fallback ??= chime();
    };
    const accepted = speechRef.current.say(message, {
      volume: current.volume,
      rate: current.speechRate,
      voiceURI: current.voiceURI,
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

  const preview = useCallback(async () => {
    stop();
    setTesting(true);
    const result = await speak('알림 음성을 확인합니다. 경험치 영역에 변화가 없으면 알려드릴게요.', true);
    if (!result || settingsRef.current.notificationSound === 'chime') setTesting(false);
    return result;
  }, [speak, stop]);

  return { voices, audioReady, voiceError, testing, preview, speakAlert: speak, stop };
}
