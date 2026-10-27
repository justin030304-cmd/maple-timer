import { locateExperienceRegion } from './lib/experienceVisual';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, AudioLines, Bell, Check, ChevronDown, ChevronRight, CircleHelp, Crosshair, Focus, LayoutDashboard, Leaf, Maximize, Monitor as MonitorIcon, MonitorUp, Plus, Settings2, ShieldCheck, Sparkles, Square, Trash2, Volume2, VolumeX, WandSparkles, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ScreenPreview from './components/ScreenPreview';
import { loadSettings, saveSettings } from './lib/settings';
import { formatTime, timerRuntime } from './lib/engine';
import { normalizeROI } from './lib/roi';
import { isLikelyFemaleVoice, selectVoice } from './lib/speech';
import { useNotificationAudio } from './hooks/useNotificationAudio';
import { useRuneDetection } from './hooks/useRuneDetection';
import { useExperienceDetection } from './hooks/useExperienceDetection';
import type { ModuleKind, Monitor, ROI } from './types';

type LogEntry = { id: number; time: number; message: string; tone: 'info' | 'success' | 'warning' };
const moduleMeta: Record<ModuleKind, { title: string; sub: string; icon: LucideIcon; className: string }> = {
  rune: { title: '룬 인식', sub: '미니맵의 마름모 아이콘을 찾아요', icon: Sparkles, className: 'purple' },
  buff: { title: '버프 관리', sub: '나의 버프를 한눈에', icon: WandSparkles, className: 'amber' },
  exp: { title: '경험치 인식', sub: '숫자가 멈추면 알려드려요', icon: Activity, className: 'mint' },
  booster: { title: '부스터', sub: '부스터의 남은 시간', icon: Zap, className: 'blue' },
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}><span /></button>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sharingState, setSharingState] = useState<'idle' | 'requesting' | 'active' | 'ended' | 'error'>('idle');
  const [shareError, setShareError] = useState('');
  const [events, setEvents] = useState<Record<string, number | null>>({});
  const [now, setNow] = useState(Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modal, setModal] = useState<'settings' | 'guide' | null>(null);
  const [storageOK, setStorageOK] = useState(true);
  const [toast, setToast] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([{ id: 0, time: Date.now(), message: '화면 공유를 시작하고 모듈별 인식 영역을 지정해 주세요.', tone: 'info' }]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const notified = useRef<Record<string, string>>({});
  const mounted = useRef(true);
  const eventId = useRef(1);
  const sessionStarted = useRef(Date.now());

  const log = useCallback((message: string, tone: LogEntry['tone'] = 'info') => {
    setLogs((previous) => [{ id: eventId.current++, time: Date.now(), message, tone }, ...previous].slice(0, 30));
  }, []);
  const notify = useCallback((message: string) => { setToast(message); }, []);
  const { voices, audioReady, voiceError, testing, preview, speakAlert, stop: stopAudio } = useNotificationAudio(settings, notify);
  const selectedVoice = selectVoice(voices, settings.voiceURI);
  const missingSavedVoice = !!settings.voiceURI && !voices.some((voice) => voice.voiceURI === settings.voiceURI);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => { setStorageOK(saveSettings(settings)); }, [settings]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const stopSharing = useCallback((ended = true) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setEvents({});
    setSharingState(ended ? 'ended' : 'idle');
    stopAudio();
  }, [stopAudio]);

  const startSharing = async () => {
    if (sharingState === 'requesting') return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      setSharingState('error');
      setShareError('화면 공유는 데스크톱 Chrome의 HTTPS 또는 localhost 환경에서 지원됩니다.');
      return;
    }
    setSharingState('requesting');
    setShareError('');
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
      if (!mounted.current) { captured.getTracks().forEach((track) => track.stop()); return; }
      stopSharing(false);
      captured.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current !== captured) return;
        stopSharing();
        log('브라우저에서 화면 공유가 종료되었습니다.', 'warning');
      }, { once: true });
      streamRef.current = captured;
      setStream(captured);
      setSharingState('active');
      setNow(Date.now());
      setEditingId(null);
      notified.current = {};
      log('화면 공유가 연결되었습니다. 인식 영역을 지정해 주세요.', 'success');
    } catch (error) {
      if (!mounted.current) return;
      setSharingState('error');
      const name = error instanceof DOMException ? error.name : '';
      setShareError(name === 'NotAllowedError'
        ? '공유가 취소되었거나 권한이 허용되지 않았습니다. 다시 화면을 선택해 주세요.'
        : name === 'NotReadableError'
          ? '선택한 화면을 읽을 수 없습니다. 운영체제의 화면 기록 권한을 확인해 주세요.'
          : '화면 공유를 시작하지 못했습니다. Chrome과 화면 공유 권한을 확인해 주세요.');
      log('화면 공유에 연결하지 못했습니다.', 'warning');
    }
  };

  const updateMonitor = (id: string, patch: Partial<Monitor>) => {
    if (['exp', 'rune'].includes(settings.monitors.find((monitor) => monitor.id === id)?.kind ?? '') && ('roi' in patch || 'enabled' in patch)) {
      setEvents((previous) => ({ ...previous, [id]: null }));
      notified.current[id] = '';
      stopAudio();
    }
    setSettings((previous) => ({ ...previous, monitors: previous.monitors.map((monitor) => monitor.id === id ? { ...monitor, ...patch } : monitor) }));
  };
  const setRoi = (id: string, roi: ROI) => {
    const normalized = normalizeROI(roi);
    if (normalized) updateMonitor(id, { roi: normalized });
  };
  const expMonitor = settings.monitors.find((monitor) => monitor.kind === 'exp');
  const runeMonitor = settings.monitors.find((monitor) => monitor.kind === 'rune');
  const onRuneDetected = useCallback((timestamp: number) => {
    if (!runeMonitor) return;
    setEvents((previous) => ({ ...previous, [runeMonitor.id]: timestamp }));
    const message = '룬 아이콘 후보가 감지되었습니다. 미니맵을 확인해 주세요.';
    log(message, 'warning');
    notify(message);
    void speakAlert(message);
  }, [runeMonitor?.id, log, notify, speakAlert]);
  const { observation: runeObservation, candidate: runeCandidate } = useRuneDetection({
    stream, videoRef, monitor: runeMonitor, settings: settings.runeDetection, onDetected: onRuneDetected,
  });

  const experience = useExperienceDetection({ stream, videoRef, monitor: expMonitor, mode: settings.expDetectionMode });

  const [experienceRegionError, setExperienceRegionError] = useState('');
  const findExperienceRegion = useCallback(() => {
    const video = videoRef.current;
    if (!stream || !video || video.readyState < 2) return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return false;
      context.drawImage(video, 0, 0);
      const found = locateExperienceRegion(context.getImageData(0, 0, canvas.width, canvas.height));
      if (!found) { setExperienceRegionError('하단 경험치 바를 찾지 못했습니다. 게임 화면 하단이 보이는지 확인하거나 직접 영역을 지정해 주세요.'); return false; }
      setSettings(current => ({ ...current, monitors: current.monitors.map(item => item.kind === 'exp' ? { ...item, roi: found } : item) }));
      setExperienceRegionError('');
      return true;
    } catch { setExperienceRegionError('공유 화면을 읽을 수 없습니다. 화면 공유 상태를 확인해 주세요.'); return false; }
  }, [stream]);
  useEffect(() => {
    if (!stream || !expMonitor?.enabled || expMonitor.roi) return;
    const timer = window.setInterval(findExperienceRegion, 1000);
    return () => clearInterval(timer);
  }, [stream, expMonitor?.enabled, expMonitor?.roi, findExperienceRegion]);

  const runtimes = Object.fromEntries(settings.monitors.map((monitor) => [monitor.id, timerRuntime(monitor, events[monitor.id] ?? null, now, {
    expIdleSec: settings.expIdleSec,
    hasSource: !!stream,
    exp: monitor.kind === 'exp' ? experience.observation : undefined,
    rune: monitor.kind === 'rune' ? runeObservation : undefined,
  })]));
  useEffect(() => {
    for (const monitor of settings.monitors) {
      const runtime = runtimes[monitor.id];
      const shouldAlert = monitor.kind === 'exp' ? runtime.status === 'expired' : runtime.status === 'warning' || runtime.status === 'expired';
      const token = `${runtime.lastEventAt}:${runtime.status}:${monitor.kind === 'exp' ? settings.expIdleSec : monitor.durationSec}`;
      if (!shouldAlert || notified.current[monitor.id] === token) continue;
      notified.current[monitor.id] = token;
      const text = monitor.kind === 'exp'
        ? `경험치 숫자가 ${settings.expIdleSec}초 동안 변하지 않았습니다.`
        : `${monitor.name} ${runtime.status === 'expired' ? '시간이 종료되었습니다.' : '종료 시간이 가까워졌습니다.'}`;
      log(text, 'warning');
      notify(text);
      void speakAlert(text);
    }
  });

  const editingMonitor = settings.monitors.find((monitor) => monitor.id === editingId);
  const activeCount = settings.monitors.filter((monitor) => monitor.enabled).length;
  const addBuff = () => {
    if (settings.monitors.length >= 50) { notify('모듈은 최대 50개까지 등록할 수 있습니다.'); return; }
    const id = `buff-${crypto.randomUUID()}`;
    const monitor: Monitor = { id, kind: 'buff', name: '새 버프', enabled: true, roi: null, durationSec: 1800, warnBeforeSec: 60 };
    setSettings((previous) => ({ ...previous, monitors: [...previous.monitors, monitor] }));
    setExpandedId(id);
    log('새 버프를 추가했습니다. 이름과 시간을 설정해 주세요.');
  };

  const renderMonitor = (monitor: Monitor) => {
    const runtime = runtimes[monitor.id];
    const expanded = expandedId === monitor.id;
    const meta = moduleMeta[monitor.kind];
    const isRune = monitor.kind === 'rune';
    const activeTimer = ['running', 'warning', 'expired'].includes(runtime.status);
    const detected = runtime.status === 'detected';
    const watching = runtime.status === 'watching';
    const statusLabel = !monitor.enabled ? '비활성화'
      : detected ? '룬 후보 감지' : watching ? '아이콘 감시 중'
      : runtime.status === 'running' ? '숫자 감시 중'
      : runtime.status === 'warning' ? '종료 임박' : runtime.status === 'expired' ? '알림 발생'
      : runtime.status === 'no-sample' ? '샘플 필요' : runtime.status === 'error' ? monitor.kind === 'exp' ? '인식 실패' : '분석 실패' : '대기 중';
    const digits = !monitor.enabled ? 'OFF'
      : isRune ? detected ? '발견' : watching ? '감시 중' : runtime.status === 'error' ? '확인 필요' : '대기'
      : activeTimer ? formatTime(runtime.remainingSec) : '--:--';
    const percentage = isRune ? detected ? 100 : 0
      : monitor.enabled && activeTimer ? Math.max(0, Math.min(100, runtime.remainingSec / (monitor.kind === 'exp' ? settings.expIdleSec : monitor.durationSec) * 100)) : 0;
    return <div className={`monitor-item ${!monitor.enabled ? 'disabled' : ''}`} key={monitor.id}>
      <div className="monitor-row">
        <button className="monitor-name" onClick={() => setExpandedId(expanded ? null : monitor.id)} aria-expanded={expanded}>
          <span>{monitor.name}</span>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Toggle checked={monitor.enabled} onChange={() => updateMonitor(monitor.id, { enabled: !monitor.enabled })} label={`${monitor.name} 활성화`} />
      </div>
      <div className="timer-row">
        <span className={`timer-digits ${isRune ? 'rune-state' : ''} ${detected || runtime.status === 'warning' || runtime.status === 'expired' ? 'warn' : ''}`}>{digits}</span>
        <span className={`tiny-status ${runtime.status === 'running' || detected || watching ? meta.className : ''}`}><i />{statusLabel}</span>
      </div>
      <div className="timer-track"><span className={meta.className} style={{ width: `${percentage}%` }} /></div>
      <div className="monitor-bottom">
        <button className={`roi-link ${monitor.roi ? 'configured' : ''}`} onClick={() => setEditingId(editingId === monitor.id ? null : monitor.id)}><Crosshair size={14} />{editingId === monitor.id ? '영역 지정 중' : monitor.roi ? '인식 영역 설정됨' : '인식 영역 지정'}</button>
        <span>{isRune ? '색상·모양 · 실험' : monitor.kind === 'exp' ? settings.expDetectionMode === 'visual' ? '숫자 모양 · 실험' : '숫자 OCR · 실험' : '자동 인식 준비 중'}</span>
      </div>
      {monitor.kind === 'exp' && <div className="experience-reading">
        <span>{settings.expDetectionMode === 'visual' ? '숫자 모양 변화 감시' : experience.observation?.valid ? '현재 경험치' : '마지막 확인 경험치'}</span>
        <strong data-testid="experience-value">{settings.expDetectionMode === 'visual' ? experience.observation?.valid ? '숫자 영역 확인됨' : '--' : experience.value?.display ?? '--'}</strong>
        {experience.observation?.loading && <p>숫자 인식 모델 준비 중입니다. 처음 사용할 때는 잠시 걸릴 수 있어요.</p>}
        {runtime.status === 'error' && <p role="status" className="experience-error">{runtime.detail}</p>}
        {experience.observation?.confirming && <p>{settings.expDetectionMode === 'visual' ? '숫자 영역을 연속 프레임에서 확인하고 있습니다.' : '같은 숫자를 연속으로 확인하고 있습니다.'}</p>}
        {experience.value?.kind === 'percent' && <p>퍼센트만 읽고 있습니다. 작은 변화를 감지하려면 총 경험치 숫자도 포함해 주세요.</p>}
      </div>}
      {isRune && !!stream && monitor.enabled && !audioReady && <button className="button small rune-audio-button" onClick={() => {
        setSettings((current) => ({ ...current, soundEnabled: true }));
        void preview();
      }}><Volume2 size={15} />룬 알림 소리 켜기</button>}
      {expanded && <div className="monitor-settings">
        {monitor.kind === 'buff' && <label>버프 이름<input aria-label="버프 이름" maxLength={40} value={monitor.name} onChange={(event) => updateMonitor(monitor.id, { name: event.target.value })} /></label>}
        {isRune ? <div className="rune-settings">
          <p>미니맵 부분을 인식 영역으로 지정해 주세요. 설명용 빨간 테두리가 아니라 안쪽의 보라·하늘색 또는 흰 테두리의 보라색 마름모를 찾습니다.</p>
          <label>일치 기준 (점)<div className="rune-threshold"><input type="range" aria-label="일치 기준 (점)" min={40} max={95} value={Math.round(settings.runeDetection.minScore * 100)} onChange={(event) => setSettings((current) => ({ ...current, runeDetection: { ...current.runeDetection, minScore: Number(event.target.value) / 100 } }))} /><span>{Math.round(settings.runeDetection.minScore * 100)}점</span></div></label>
          <div className="field-pair">
            <label>아이콘 최소 크기 (px)<input type="number" min={3} max={64} value={settings.runeDetection.minSize} onChange={(event) => {
              const value = Math.max(3, Math.min(64, Number(event.target.value)));
              setSettings((current) => ({ ...current, runeDetection: { ...current.runeDetection, minSize: value, maxSize: Math.max(value, current.runeDetection.maxSize) } }));
            }} /></label>
            <label>아이콘 최대 크기 (px)<input type="number" min={settings.runeDetection.minSize} max={128} value={settings.runeDetection.maxSize} onChange={(event) => {
              const value = Math.max(settings.runeDetection.minSize, Math.min(128, Number(event.target.value)));
              setSettings((current) => ({ ...current, runeDetection: { ...current.runeDetection, maxSize: value } }));
            }} /></label>
          </div>
          <p className="rune-score">현재 후보 점수: {runeObservation?.score == null ? '없음' : `${Math.round(runeObservation.score * 100)}점`} · 정확도 수치가 아닙니다.</p>
          {runeObservation?.hint && <p>{runeObservation.hint}</p>}
          <p>3프레임 연속 확인되면 한 번 알립니다. 2초 이상 사라져야 다시 감지하며, 알림 간격은 최소 10초입니다. 해상도·색상·겹치는 표시에 따라 오탐·누락이 있을 수 있습니다.</p>
          {events[monitor.id] != null && <p>마지막 알림: {new Date(events[monitor.id]!).toLocaleTimeString('ko-KR', { hour12: false })}</p>}
        </div> : <div className="field-pair">
          <label>{monitor.kind === 'exp' ? '변화 없음 경고 (초)' : '지속 시간 (초)'}<input type="number" min={monitor.kind === 'exp' ? 5 : 1} max={monitor.kind === 'exp' ? 3600 : 86400} value={monitor.kind === 'exp' ? settings.expIdleSec : monitor.durationSec} onChange={(event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            if (monitor.kind === 'exp') setSettings((current) => ({ ...current, expIdleSec: Math.max(5, Math.min(3600, value)) }));
            else updateMonitor(monitor.id, { durationSec: Math.max(1, Math.min(86400, value)), warnBeforeSec: Math.max(0, Math.min(monitor.warnBeforeSec, value)) });
          }} /></label>
          {monitor.kind !== 'exp' && <label>미리 알림 (초)<input type="number" min={0} max={monitor.durationSec} value={monitor.warnBeforeSec} onChange={(event) => updateMonitor(monitor.id, { warnBeforeSec: Math.max(0, Math.min(monitor.durationSec, Number(event.target.value))) })} /></label>}
        </div>}
        <p>{runtime.detail}</p>
        {monitor.kind === 'exp' && <div className="experience-settings">
          <label>경험치 인식 방식<select value={settings.expDetectionMode} onChange={event => setSettings(current => ({ ...current, expDetectionMode: event.target.value as 'visual' | 'ocr' }))}><option value="visual">숫자 모양 변화 감시 · 작은 글자용</option><option value="ocr">숫자 읽기 · OCR</option></select></label>
          <button className="button small" disabled={!stream} onClick={findExperienceRegion}>경험치 영역 자동 찾기</button>
          {experienceRegionError && <p role="status">{experienceRegionError}</p>}
          {settings.expDetectionMode === 'visual' && <p>작은 글자는 숫자 획의 변화를 비교합니다. 경험치 값으로 변환하지 않으며 바의 길이나 주변 이펙트는 비교하지 않습니다. 압축 잡음보다 작은 변화는 놓칠 수 있습니다.</p>}
          <p>하단 연두색 경험치 바의 흰 숫자 전체를 인식 영역으로 지정해 주세요. 주변 효과나 바의 색 변화가 아니라 숫자 부분만 비교합니다.</p>
          <p>{settings.expDetectionMode === 'visual' ? '연속 프레임에서 숫자 모양이 확인되면 감시를 시작합니다.' : '연속 2회 같은 숫자가 확인되면 감시를 시작합니다.'} 숫자가 바뀌면 대기 시간을 다시 세며, 숫자를 읽지 못하면 알림을 보류하고 정상 판독 후 새로 시작합니다.</p>
          {experience.confidence !== null && <p>OCR 판독 점수: {Math.round(experience.confidence)}점 · 정확도 수치가 아닙니다.</p>}
          {experience.rawText && <p className="experience-raw">최근 읽힌 문자: {experience.rawText}</p>}
          {experience.sourcePreview && <div><p>실제로 잘라낸 화면 · 흰 경험치 숫자 전체가 보여야 합니다.</p><img className="experience-preview" src={experience.sourcePreview} alt="경험치 원본 인식 영역" /></div>}
          {experience.preview && <img className="experience-preview" src={experience.preview} alt="경험치 숫자 인식 미리보기" />}
          <button className="button small" disabled={!stream || !monitor.enabled || !monitor.roi || experience.observation?.loading} onClick={() => { stopAudio(); experience.retry(); }}>숫자 인식 다시 시작</button>
          <p>영상은 브라우저 안에서만 분석합니다. {settings.expDetectionMode === 'visual' ? '작은 숫자 모양의 변화로 무변화 시간을 추정합니다. 미리보기에 경험치 숫자만 보이는지 확인해 주세요.' : '인식 모델과 글꼴·해상도에 따라 오인식할 수 있으므로 현재 경험치 표시가 게임 숫자와 맞는지 확인해 주세요.'}</p>
        </div>}

        <div className="monitor-actions">
          {monitor.roi && <button className="text-button" onClick={() => updateMonitor(monitor.id, { roi: null })}>영역 초기화</button>}
          {monitor.kind === 'buff' && <button className="icon-button danger" aria-label={`${monitor.name} 삭제`} onClick={() => {
            setSettings((current) => ({ ...current, monitors: current.monitors.filter((item) => item.id !== monitor.id) }));
            if (editingId === monitor.id) setEditingId(null);
          }}><Trash2 size={16} /></button>}
        </div>
      </div>}
    </div>;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Maple Watch 홈" onClick={(event) => { event.preventDefault(); setModal(null); }}><span className="brand-symbol"><Leaf size={25} fill="currentColor" /></span><span>maple<span className="brand-light">watch</span><small>YOUR PERSONAL COMPANION</small></span></a>
      <div className="workspace-label">워크스페이스 <span>PERSONAL</span></div>
      <nav>
        <button className={!modal ? 'active' : ''} onClick={() => setModal(null)}><LayoutDashboard size={19} />대시보드<span className="nav-mark" /></button>
        <button className={modal === 'settings' ? 'active' : ''} onClick={() => setModal('settings')}><Settings2 size={19} />알림 설정</button>
        <button className={modal === 'guide' ? 'active' : ''} onClick={() => setModal('guide')}><CircleHelp size={19} />사용 가이드<ArrowDownLeft size={15} className="nav-arrow" /></button>
      </nav>
      <div className="sidebar-tip"><div className="mini-leaf"><Leaf size={21} /></div><strong>조금 더 편안한 사냥</strong><p>타이밍은 맡겨두고,<br />나만의 페이스로 즐기세요.</p><span>MADE FOR MAPLERS <span>↗</span></span></div>
      <div className="sidebar-bottom"><div className="local-dot" /><div><strong>내 브라우저에서만 처리</strong><small>화면 영상은 전송되지 않아요</small></div><ShieldCheck size={18} /></div>
      <div className="sidebar-version"><span>MAPLE WATCH</span><span>v0.4.0 BETA</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">워크스페이스<ChevronRight size={15} /><strong>대시보드</strong></div><div className="topbar-right"><span className="privacy"><ShieldCheck size={16} />프라이버시 우선</span><span className="topbar-separator" /><button className="icon-button" aria-label="알림 설정 열기" onClick={() => setModal('settings')}><Bell size={20} /></button><span className="avatar">M</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">A LITTLE HELP, A BETTER HUNT.</div><h1>사냥에만 집중하세요<span>.</span></h1><p>룬부터 버프까지, 놓치기 쉬운 순간을 함께 챙겨요.</p></div><button className="button guide-button" onClick={() => setModal('guide')}><CircleHelp size={17} />처음이신가요?<ArrowRight size={16} /></button></div>
        <div className="share-toolbar"><div className="share-toolbar-title"><MonitorIcon size={19} /><strong>게임 화면 연결</strong></div><div className="mode-note"><span className={`status-dot ${stream ? 'green' : ''}`} />{stream ? '화면 공유 연결됨 · 로컬 처리 중' : sharingState === 'ended' ? '화면 공유가 종료되었습니다' : '화면 공유 대기 중'}</div></div>
        {shareError && <div role="alert" className="error-banner"><MonitorIcon size={18} /><span>{shareError}</span><button className="icon-button" aria-label="공유 오류 닫기" onClick={() => setShareError('')}><X size={18} /></button></div>}
        {!storageOK && <div role="alert" className="error-banner">설정을 저장하지 못했습니다. 브라우저 저장 공간 및 개인정보 보호 설정을 확인해 주세요.</div>}
        <div className="dashboard-grid">
          <div className="main-column">
            <section className="panel preview-panel">
              <div className="panel-heading"><div><MonitorIcon size={18} /><h2>화면 미리보기</h2><span className={`badge ${stream ? 'live' : ''}`}>{stream ? 'LIVE' : 'OFFLINE'}</span></div><span className="small-muted">{stream ? '공유 중인 화면' : '연결된 화면 없음'}</span></div>
              <ScreenPreview runeCandidate={runeCandidate} stream={stream} monitors={settings.monitors} editingId={editingId} onSelectMonitor={setEditingId} onRoiChange={setRoi} onVideoReady={(video) => { videoRef.current = video; }} />
              <div className="preview-controls"><div className="preview-state"><span className={`status-dot ${stream ? 'green' : ''}`} /><strong>{stream ? '화면 공유 중' : sharingState === 'ended' ? '공유 종료됨' : '화면 연결 대기'}</strong><span>영상은 서버에 저장되지 않습니다</span></div><div className="preview-buttons">
                {stream ? <button className="button small" onClick={() => { stopSharing(); log('화면 공유를 종료했습니다.'); }}><Square size={14} />공유 종료</button> : <button className="button primary small" onClick={() => void startSharing()} disabled={sharingState === 'requesting'}><MonitorUp size={17} />{sharingState === 'requesting' ? '화면 선택 중…' : '화면 공유 시작'}</button>}
                <button className={`icon-button ${editingId ? 'highlight' : ''}`} aria-label="인식 영역 편집" onClick={() => setEditingId(editingId ? null : settings.monitors.find((monitor) => monitor.enabled)?.id ?? settings.monitors[0]?.id ?? null)}><Maximize size={18} /></button>
              </div></div>
            </section>
            <section className="panel roi-panel">
              <div className="roi-intro"><span className="outlined-icon"><Focus size={23} /></span><div><h2>어디를 살펴볼까요?</h2><p>모듈을 선택하고 화면을 드래그해 인식 영역을 지정하세요.</p></div><span className="step-number">01 — 04</span></div>
              <div className="roi-chips">{settings.monitors.map((monitor) => <button key={monitor.id} className={`roi-chip ${editingId === monitor.id ? 'selected' : ''}`} onClick={() => setEditingId(editingId === monitor.id ? null : monitor.id)}><span className={`chip-dot ${moduleMeta[monitor.kind].className}`} />{monitor.name}{monitor.roi ? <Check size={14} /> : <Plus size={14} />}</button>)}</div>
              {editingMonitor && <div className="roi-editor">
                <div className="roi-edit-title"><Crosshair size={16} /><strong>{editingMonitor.name}</strong><span>드래그로 그리기 · 영역 안에서 이동</span><button className="icon-button" aria-label="영역 편집 완료" onClick={() => setEditingId(null)}><Check size={18} /></button></div>
                <div className="roi-coordinates">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{{ x: 'X', y: 'Y', width: '너비', height: '높이' }[key]}<div><input aria-label={`ROI ${key} (%)`} type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={100} step={.1} value={Number(((editingMonitor.roi?.[key] ?? (key === 'width' || key === 'height' ? .2 : .1)) * 100).toFixed(1))} onChange={(event) => setRoi(editingMonitor.id, { ...(editingMonitor.roi ?? { x: .1, y: .1, width: .2, height: .2 }), [key]: Number(event.target.value) / 100 })} /><span>%</span></div></label>)}</div>
                <p>공유 화면의 비율로 저장됩니다. 창 크기나 해상도가 바뀌면 영역을 다시 확인해 주세요.</p>
              </div>}
            </section>
            <div className="recognition-notice"><ShieldCheck size={23} /><div><strong>화면 인식 기능 안내</strong><p>룬은 지정한 미니맵에서 보라·하늘색 또는 흰 테두리의 보라색 마름모를 찾는 실험 감지입니다. 버프·부스터는 준비 중이며, 경험치는 숫자 모양 변화 감시와 OCR 중 선택할 수 있습니다. 실제 판독값을 확인해 주세요.</p></div></div>
            <section className="panel activity-panel">
              <div className="panel-heading"><div><AudioLines size={18} /><h2>활동 기록</h2><span className="count-badge">{logs.length}</span></div><button className="text-button" onClick={() => setLogs([])} disabled={!logs.length}>기록 지우기</button></div>
              <div className="activity-list" aria-live="polite">{logs.length ? logs.slice(0, 4).map((entry) => <div className="activity-row" key={entry.id}><span className={`log-dot ${entry.tone}`} /><time>{new Date(entry.time).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{entry.message}</p></div>) : <p className="empty-log">아직 기록이 없습니다. 감지 이벤트가 이곳에 표시됩니다.</p>}</div>
            </section>
          </div>
          <aside className="modules-column"><div className="modules-heading"><h2>모니터링 모듈 <span>{activeCount}</span></h2><span>각각 독립적으로 작동해요</span></div>{(['rune', 'buff', 'exp', 'booster'] as const).map((kind) => {
            const meta = moduleMeta[kind];
            const Icon = meta.icon;
            return <section className={`panel module-panel ${meta.className}`} key={kind}><div className="module-heading"><span className={`module-icon ${meta.className}`}><Icon size={20} /></span><div><h3>{meta.title}</h3><p>{meta.sub}</p></div>{kind === 'buff' && <button className="icon-button add-buff" aria-label="새 버프 추가" onClick={addBuff}><Plus size={20} /></button>}</div>{settings.monitors.filter((monitor) => monitor.kind === kind).map(renderMonitor)}{kind === 'buff' && !settings.monitors.some((monitor) => monitor.kind === 'buff') && <button className="button empty-buff" onClick={addBuff}><Plus size={17} />첫 버프 등록하기</button>}</section>;
          })}</aside>
        </div>
        <footer><span><ShieldCheck size={16} />게임 메모리 접근 없이, 화면만 살펴봅니다.</span><span>나만의 페이스, 나만의 메이플.<Leaf size={15} /></span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Bell size={18} /><span>{toast}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setToast('')}><X size={17} /></button></div>}
    {modal && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setModal(null); }}><Modal title={modal === 'settings' ? '나에게 맞는 알림' : 'Maple Watch 시작하기'} onClose={() => setModal(null)}>
      {modal === 'settings' ? <>
        <p className="modal-description">알림을 한국어 음성으로 들어보세요. 설정은 이 브라우저에 자동 저장됩니다.</p>
        <div className="settings-row"><div><strong>소리 알림</strong><p>룬 아이콘이 나타나거나 경험치 숫자가 멈추면 알려드려요</p></div><Toggle checked={settings.soundEnabled} onChange={() => setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }))} label="소리 알림 활성화" /></div>
        <div className="speech-settings">
          <label>알림 방식<select aria-label="알림 방식" value={settings.notificationSound} onChange={(event) => setSettings((current) => ({ ...current, notificationSound: event.target.value as 'speech' | 'chime' }))}><option value="speech">한국어 TTS 음성</option><option value="chime">기본 알림음</option></select></label>
          {settings.notificationSound === 'speech' && <>
            <label>알림 음성<select aria-label="알림 음성" value={settings.voiceURI} onChange={(event) => setSettings((current) => ({ ...current, voiceURI: event.target.value }))}><option value="">여성 음성 우선 · 자동 선택</option>{missingSavedVoice && <option value={settings.voiceURI}>저장된 음성 · 이 기기에서 사용 불가</option>}{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}{isLikelyFemaleVoice(voice) ? ' · 여성 음성 우선 후보' : ''}{voice.localService ? ' · 기기 음성' : ''}</option>)}</select></label>
            <p className="voice-status">{selectedVoice ? `선택된 음성: ${selectedVoice.name}${missingSavedVoice ? ' (저장된 음성이 없어 자동 선택)' : ''}` : '사용 가능한 한국어 음성이 없습니다. 기기의 한국어 음성을 설치하거나 브라우저 음성 목록이 로드될 때까지 기다려 주세요.'}</p>
            <label className="volume-label">말하기 속도<span>{settings.speechRate.toFixed(2)}×</span><div><span>느리게</span><input type="range" min={.7} max={1.3} step={.05} value={settings.speechRate} onChange={(event) => setSettings((current) => ({ ...current, speechRate: Number(event.target.value) }))} aria-label="말하기 속도" /><span>빠르게</span></div></label>
            <p className="voice-help">여성 목소리로 알려진 한국어 음성을 우선 선택합니다. 브라우저는 성별 정보를 제공하지 않으므로, 원하는 목소리를 직접 선택하고 들어보세요. 제공되는 음성은 기기마다 다릅니다.</p>
          </>}
        </div>
        <label className="volume-label">알림 음량<span>{Math.round(settings.volume * 100)}%</span><div><VolumeX size={18} /><input type="range" min={0} max={1} step={.01} value={settings.volume} onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.target.value) }))} aria-label="알림 음량" /><Volume2 size={20} /></div></label>
        <div className="sound-test"><button className="button primary" disabled={testing} onClick={async () => { if (await preview()) notify('알림 소리 테스트를 요청했습니다. 선택한 목소리를 확인해 주세요.'); }}><Volume2 size={18} />{testing ? '음성 재생 대기 중…' : '알림 소리 테스트'}</button><span className={audioReady ? 'text-green' : ''}>{audioReady ? '소리 사용 준비 완료' : '한 번 눌러 소리를 허용해 주세요'}</span></div>
        {voiceError && <p role="status" className="voice-status">{voiceError}</p>}
        <div className="setting-note"><Bell size={20} /><p>알림 내용을 선택한 목소리로 읽어드립니다. 한국어 음성이 없거나 재생에 실패하면 기본 알림음으로 대신 알립니다. 먼저 테스트 버튼을 눌러 소리를 허용해 주세요.</p></div>
        <p className="modal-footnote">음성은 브라우저·운영체제가 제공하며, 일부 음성은 온라인 서비스를 이용할 수 있습니다. 화면 영상은 전송하지 않습니다. 브라우저 종료·백그라운드·절전 상태에서는 알림이 중단되거나 지연될 수 있습니다.</p>
      </> : <>
        <p className="modal-description">Chrome에서 게임 화면을 연결해 시작하세요.</p>
        <ol className="guide-steps">
          <li><span>01</span><div><strong>화면 공유하기</strong><p>‘화면 공유 시작’을 눌러 게임 창이나 화면을 선택하세요. HTTPS 또는 localhost가 필요하며, 게임 창을 최소화하면 프레임이 멈출 수 있어요.</p></div></li>
          <li><span>02</span><div><strong>모듈별 인식 영역 지정하기</strong><p>룬 영역은 미니맵 부분에 좁게 맞춰 주세요. 화면 전체를 지정하면 작은 아이콘을 놓칠 수 있습니다. 영역 안을 드래그해 이동하거나 수치로 정밀하게 수정할 수 있습니다.</p></div></li>
          <li><span>03</span><div><strong>경험치 숫자 영역 지정하기</strong><p>하단 연두색 바의 흰 경험치 숫자를 포함해 주세요. 작은 글자는 숫자 모양 감시를 사용하고, OCR 모드에서는 판독값을 확인하세요. 변화 없음 경고 시간을 설정하세요. 읽기 실패 중에는 알림을 울리지 않습니다.</p></div></li>
          <li><span>04</span><div><strong>알림 목소리 선택하기</strong><p>알림 설정에서 한국어 여성 음성을 선택하고 테스트 버튼을 눌러 주세요. 룬은 미니맵 마름모 아이콘을 실험적으로 감지하며, 버프·부스터 자동 인식은 아직 준비 중입니다.</p></div></li>
        </ol>
        <div className="setting-note"><ShieldCheck size={23} /><p>영상은 브라우저 메모리에서만 처리합니다. 게임 메모리 접근, 자동 키 입력, 게임 조작 기능은 없습니다.</p></div>
      </>}
    </Modal></div>}
    <div className="audio-dock"><span className={`status-dot ${stream ? 'green' : ''}`} />{stream ? 'LIVE SESSION' : 'LOCAL WORKSPACE'}<span className="session-clock">{formatTime((now - sessionStarted.current) / 1000)}</span><button onClick={() => {
      if (!audioReady) { setSettings((current) => ({ ...current, soundEnabled: true })); void preview(); }
      else setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }));
    }} title={voiceError || '알림 소리 설정'} aria-label={!audioReady ? '소리 알림 활성화' : settings.soundEnabled ? '소리 끄기' : '소리 켜기'}>{settings.soundEnabled && audioReady ? <Volume2 size={17} /> : <VolumeX size={17} />}<span>{!audioReady ? '소리 활성화' : settings.soundEnabled ? voiceError && settings.notificationSound === 'speech' ? '기본 알림음' : '소리 켜짐' : '음소거'}</span></button></div>
  </div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href], [tabindex="0"]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div className="eyebrow">MAKE IT YOURS</div><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="창 닫기" onClick={onClose}><X size={23} /></button></div>{children}<div className="modal-actions"><span><Check size={16} />설정 자동 저장</span><button className="button" onClick={onClose}>완료<ArrowRight size={17} /></button></div></div>;
}
