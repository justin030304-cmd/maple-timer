import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, AudioLines, Bell, Check, ChevronDown, ChevronRight, CircleHelp, Crosshair, FlaskConical, Focus, LayoutDashboard, Leaf, Maximize, Monitor as MonitorIcon, MonitorUp, Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, Trash2, Volume2, VolumeX, WandSparkles, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ScreenPreview from './components/ScreenPreview';
import { loadSettings, saveSettings } from './lib/settings';
import { formatTime, timerRuntime } from './lib/engine';
import { measureFrameChange } from './lib/analysis';
import type { PixelFrame } from './lib/analysis';
import { normalizeROI } from './lib/roi';
import type { Mode, ModuleKind, Monitor, ROI } from './types';

type LogEntry = { id: number; time: number; message: string; tone: 'info' | 'success' | 'warning' };
const moduleMeta: Record<ModuleKind, { title: string; sub: string; icon: LucideIcon; className: string }> = {
  rune: { title: '룬 타이머', sub: '다음 룬까지, 놓치지 않게', icon: Sparkles, className: 'purple' },
  buff: { title: '버프 관리', sub: '나의 버프를 한눈에', icon: WandSparkles, className: 'amber' },
  exp: { title: '경험치 감시', sub: '사냥이 멈추면 알려드려요', icon: Activity, className: 'mint' },
  booster: { title: '부스터', sub: '부스터의 남은 시간', icon: Zap, className: 'blue' },
};
const initialEvents = (monitors: Monitor[]) => Object.fromEntries(monitors.map((m) => [m.id, Date.now() - Math.min(m.durationSec * .2, m.kind === 'rune' ? 138 : m.kind === 'buff' ? 342 : 0) * 1000]));
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}><span /></button>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [mode, setMode] = useState<Mode>('demo');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sharingState, setSharingState] = useState<'idle' | 'requesting' | 'active' | 'ended' | 'error'>('idle');
  const [shareError, setShareError] = useState('');
  const [demoRunning, setDemoRunning] = useState(true);
  const [events, setEvents] = useState<Record<string, number | null>>(() => initialEvents(settings.monitors));
  const [now, setNow] = useState(Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modal, setModal] = useState<'settings' | 'guide' | null>(null);
  const [experimentalPixels, setExperimentalPixels] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [frameDelta, setFrameDelta] = useState<number | null>(null);
  const [storageOK, setStorageOK] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [toast, setToast] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([{ id: 0, time: Date.now(), message: '데모 모드가 시작되었습니다. 가상 이벤트로 타이머를 체험해 보세요.', tone: 'info' }]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const pauseAt = useRef<number | null>(null);
  const notified = useRef<Record<string, string>>({});
  const mounted = useRef(true);
  const eventId = useRef(1);
  const sessionStarted = useRef(Date.now());
  const log = useCallback((message: string, tone: LogEntry['tone'] = 'info') => {
    setLogs((previous) => [{ id: eventId.current++, time: Date.now(), message, tone }, ...previous].slice(0, 30));
  }, []);
  const notify = useCallback((message: string) => { setToast(message); }, []);
  useEffect(() => { if (toast) { const id = window.setTimeout(() => setToast(''), 4500); return () => clearTimeout(id); } }, [toast]);
  useEffect(() => { setStorageOK(saveSettings(settings)); }, [settings]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; streamRef.current?.getTracks().forEach((t) => t.stop()); void audioRef.current?.close(); audioRef.current = null; };
  }, []);
  useEffect(() => {
    if (mode === 'demo' && !demoRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [mode, demoRunning]);

  const playSound = useCallback(async (force = false) => {
    if (!force && (!settings.soundEnabled || !audioRef.current)) return false;
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      await context.resume();
      setAudioReady(context.state === 'running');
      if (context.state !== 'running') return false;
      const start = context.currentTime;
      [659.25, 880, 987.77].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start + index * .16);
        gain.gain.linearRampToValueAtTime(settings.volume * .2, start + index * .16 + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + index * .16 + .24);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start + index * .16); oscillator.stop(start + index * .16 + .25);
      });
      return true;
    } catch { notify('소리를 재생할 수 없습니다. 브라우저의 오디오 권한을 확인해 주세요.'); return false; }
  }, [settings.soundEnabled, settings.volume, notify]);

  const stopSharing = useCallback((ended = true) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null; setStream(null); setFrameDelta(null); setFrameError(null);
    setSharingState(ended ? 'ended' : 'idle');
  }, []);
  const startSharing = async () => {
    if (sharingState === 'requesting') return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      setMode('live'); setSharingState('error'); setShareError('화면 공유는 데스크톱 Chrome의 HTTPS 또는 localhost 환경에서 지원됩니다.'); return;
    }
    setSharingState('requesting'); setShareError('');
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
      if (!mounted.current) { captured.getTracks().forEach((track) => track.stop()); return; }
      stopSharing(false);
      captured.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current !== captured) return;
        stopSharing(); log('브라우저에서 화면 공유가 종료되었습니다.', 'warning');
      }, { once: true });
      streamRef.current = captured; setStream(captured); setMode('live'); setSharingState('active');
      setEvents({}); setNow(Date.now()); setEditingId(null); notified.current = {};
      setExperimentalPixels(false);
      log('화면 공유가 연결되었습니다. 인식 영역을 지정해 주세요.', 'success');
    } catch (error) {
      if (!mounted.current) return;
      setSharingState('error');
      const name = error instanceof DOMException ? error.name : '';
      setShareError(name === 'NotAllowedError' ? '공유가 취소되었거나 권한이 허용되지 않았습니다. 다시 화면을 선택해 주세요.' : name === 'NotReadableError' ? '선택한 화면을 읽을 수 없습니다. 운영체제의 화면 기록 권한을 확인해 주세요.' : '화면 공유를 시작하지 못했습니다. Chrome과 화면 공유 권한을 확인해 주세요.');
      log('화면 공유에 연결하지 못했습니다.', 'warning');
    }
  };
  const changeMode = (next: Mode) => {
    if (sharingState === 'requesting' || next === mode) return;
    stopSharing(false); setMode(next); setEditingId(null); setFrameError(null); setExperimentalPixels(false); notified.current = {};
    setNow(Date.now()); setEvents(next === 'demo' ? initialEvents(settings.monitors) : {}); setDemoRunning(true); pauseAt.current = null;
    log(next === 'demo' ? '데모 모드로 전환했습니다. 모든 이벤트는 가상 데이터입니다.' : '실제 화면 모드입니다. 화면 공유를 시작해 주세요.');
  };
  const updateMonitor = (id: string, patch: Partial<Monitor>) => {
    if (mode === 'live' && settings.monitors.find((m) => m.id === id)?.kind === 'exp' && ('roi' in patch || 'enabled' in patch)) {
      setEvents((previous) => ({ ...previous, [id]: null }));
      notified.current[id] = '';
    }
    setSettings((previous) => ({ ...previous, monitors: previous.monitors.map((m) => m.id === id ? { ...m, ...patch } : m) }));
  };
  const resetEvent = (id: string) => {
    const timestamp = mode === 'demo' && !demoRunning ? now : Date.now();
    setEvents((previous) => ({ ...previous, [id]: timestamp }));
    notified.current[id] = '';
    log(`${settings.monitors.find((m) => m.id === id)?.name}: 가상 감지 이벤트를 적용했습니다.`, 'success');
  };
  const toggleDemo = () => {
    if (demoRunning) { pauseAt.current = Date.now(); setNow(pauseAt.current); }
    else {
      const gap = Date.now() - (pauseAt.current ?? Date.now());
      setEvents((previous) => Object.fromEntries(Object.entries(previous).map(([id, time]) => [id, time === null ? null : time + gap])));
      setNow(Date.now()); pauseAt.current = null;
    }
    setDemoRunning((value) => !value);
  };
  const setRoi = (id: string, roi: ROI) => {
    const normalized = normalizeROI(roi);
    if (!normalized) return;
    updateMonitor(id, { roi: normalized });
  };
  const expMonitor = settings.monitors.find((m) => m.kind === 'exp');
  const expROI = expMonitor?.roi;
  // Only a 160 x 40 crop stays in memory. No video, frame, or ROI is sent over the network.
  useEffect(() => {
    setFrameError(null); setFrameDelta(null);
    if (mode !== 'live' || !stream || !experimentalPixels || !expMonitor?.enabled || !expROI) return;
    let previous: PixelFrame | null = null;
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 40;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) { setFrameError('공유 프레임을 읽을 수 없습니다. 창이 최소화되었는지 확인해 주세요.'); return; }
      try {
        if (!context) throw new Error('canvas');
        context.drawImage(video, expROI.x * video.videoWidth, expROI.y * video.videoHeight, expROI.width * video.videoWidth, expROI.height * video.videoHeight, 0, 0, 160, 40);
        const current = context.getImageData(0, 0, 160, 40);
        const delta = measureFrameChange(previous, current);
        setFrameDelta(delta); setFrameError(null);
        if (!previous || (delta !== null && delta > .015)) setEvents((value) => ({ ...value, [expMonitor.id]: Date.now() }));
        previous = current;
      } catch { setFrameError('인식 영역의 프레임 분석에 실패했습니다. 영역을 다시 지정하거나 화면을 다시 공유해 주세요.'); }
    }, 1000);
    return () => clearInterval(id);
  }, [mode, stream, experimentalPixels, expMonitor?.enabled, expMonitor?.id, expROI?.x, expROI?.y, expROI?.width, expROI?.height]);

  const runtimes = Object.fromEntries(settings.monitors.map((m) => [m.id, timerRuntime(m, events[m.id] ?? null, now, { mode, expIdleSec: settings.expIdleSec, hasSource: !!stream, experimentalPixels, frameError: m.kind === 'exp' ? frameError : null })]));
  useEffect(() => {
    if (mode === 'demo' && !demoRunning) return;
    for (const monitor of settings.monitors) {
      const runtime = runtimes[monitor.id];
      const shouldAlert = monitor.kind === 'exp' ? runtime.status === 'expired' : runtime.status === 'warning' || runtime.status === 'expired';
      const token = `${events[monitor.id]}:${runtime.status}`;
      if (shouldAlert && notified.current[monitor.id] !== token) {
        notified.current[monitor.id] = token;
        const text = `${mode === 'demo' ? '[데모] ' : '[픽셀 감시] '}${monitor.name} · ${runtime.status === 'expired' ? '설정 시간이 지났습니다' : '종료 시간이 가까워졌습니다'}`;
        log(text, 'warning'); notify(text); void playSound();
      }
    }
  });

  const editingMonitor = settings.monitors.find((m) => m.id === editingId);
  const activeCount = settings.monitors.filter((m) => m.enabled).length;
  const addBuff = () => {
    if (settings.monitors.length >= 50) { notify('모듈은 최대 50개까지 등록할 수 있습니다.'); return; }
    const id = `buff-${crypto.randomUUID()}`;
    const monitor: Monitor = { id, kind: 'buff', name: '새 버프', enabled: true, roi: null, durationSec: 1800, warnBeforeSec: 60 };
    setSettings((previous) => ({ ...previous, monitors: [...previous.monitors, monitor] }));
    if (mode === 'demo') setEvents((previous) => ({ ...previous, [id]: now }));
    setExpandedId(id); log('새 버프를 추가했습니다. 이름과 시간을 설정해 주세요.');
  };

  const renderMonitor = (monitor: Monitor) => {
    const runtime = runtimes[monitor.id];
    const expanded = expandedId === monitor.id;
    const meta = moduleMeta[monitor.kind];
    const activeTimer = ['running', 'warning', 'expired'].includes(runtime.status);
    return <div className={`monitor-item ${!monitor.enabled ? 'disabled' : ''}`} key={monitor.id}>
      <div className="monitor-row"><button className="monitor-name" onClick={() => setExpandedId(expanded ? null : monitor.id)} aria-expanded={expanded}><span>{monitor.name}</span>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button><Toggle checked={monitor.enabled} onChange={() => updateMonitor(monitor.id, { enabled: !monitor.enabled })} label={`${monitor.name} 활성화`} /></div>
      <div className="timer-row"><span className={`timer-digits ${runtime.status === 'warning' || runtime.status === 'expired' ? 'warn' : ''}`}>{monitor.enabled ? activeTimer ? formatTime(runtime.remainingSec) : '--:--' : 'OFF'}</span><span className={`tiny-status ${runtime.status === 'running' ? meta.className : ''}`}><i />{!monitor.enabled ? '비활성화' : runtime.status === 'running' ? monitor.kind === 'exp' ? '변화 감시 중' : '타이머 작동 중' : runtime.status === 'warning' ? '종료 임박' : runtime.status === 'expired' ? '알림 발생' : runtime.status === 'no-sample' ? '샘플 필요' : runtime.status === 'error' ? '분석 실패' : '대기 중'}</span></div>
      <div className="timer-track"><span className={meta.className} style={{ width: monitor.enabled && activeTimer ? `${Math.max(0, Math.min(100, runtime.remainingSec / (monitor.kind === 'exp' ? settings.expIdleSec : monitor.durationSec) * 100))}%` : '0%' }} /></div>
      <div className="monitor-bottom"><button className={`roi-link ${monitor.roi ? 'configured' : ''}`} onClick={() => setEditingId(editingId === monitor.id ? null : monitor.id)}><Crosshair size={12} />{editingId === monitor.id ? '영역 지정 중' : monitor.roi ? '인식 영역 설정됨' : '인식 영역 지정'}</button><span>{mode === 'demo' ? '가상 이벤트' : monitor.kind === 'exp' && experimentalPixels ? '픽셀 변화 · 실험' : '실제 감지 준비 중'}</span></div>
      {expanded && <div className="monitor-settings">
        {monitor.kind === 'buff' && <label>버프 이름<input aria-label="버프 이름" maxLength={40} value={monitor.name} onChange={(e) => updateMonitor(monitor.id, { name: e.target.value })} /></label>}
        <div className="field-pair"><label>{monitor.kind === 'exp' ? '변화 없음 경고 (초)' : '지속 시간 (초)'}<input type="number" min={monitor.kind === 'exp' ? 5 : 1} max={monitor.kind === 'exp' ? 3600 : 86400} value={monitor.kind === 'exp' ? settings.expIdleSec : monitor.durationSec} onChange={(e) => { const value = Number(e.target.value); if (!Number.isFinite(value)) return; if (monitor.kind === 'exp') setSettings((s) => ({ ...s, expIdleSec: Math.max(5, Math.min(3600, value)) })); else updateMonitor(monitor.id, { durationSec: Math.max(1, Math.min(86400, value)), warnBeforeSec: Math.max(0, Math.min(monitor.warnBeforeSec, value)) }); }} /></label>
        {monitor.kind !== 'exp' && <label>미리 알림 (초)<input type="number" min={0} max={monitor.durationSec} value={monitor.warnBeforeSec} onChange={(e) => updateMonitor(monitor.id, { warnBeforeSec: Math.max(0, Math.min(monitor.durationSec, Number(e.target.value))) })} /></label>}</div>
        <p>{runtime.detail}</p>
        {monitor.kind === 'exp' && mode === 'live' && <><label className="checkbox-label"><input type="checkbox" checked={experimentalPixels} onChange={(e) => { setExperimentalPixels(e.target.checked); setEvents((v) => ({ ...v, [monitor.id]: null })); }} />실험용 픽셀 변화 감시 켜기</label><p>경험치 숫자를 읽지 않습니다. ROI의 평균 픽셀 차이 1.5%를 변화로 취급하므로 애니메이션에 반응하거나 작은 변화를 놓칠 수 있습니다.{frameDelta !== null ? ` 현재 차이 ${(frameDelta * 100).toFixed(2)}%` : ''}</p></>}
        <div className="monitor-actions">{mode === 'demo' && <button className="button small" onClick={() => resetEvent(monitor.id)} disabled={!monitor.enabled}><RotateCcw size={12} />가상 감지</button>}{monitor.roi && <button className="text-button" onClick={() => updateMonitor(monitor.id, { roi: null })}>영역 초기화</button>}{monitor.kind === 'buff' && <button className="icon-button danger" aria-label={`${monitor.name} 삭제`} onClick={() => { setSettings((s) => ({ ...s, monitors: s.monitors.filter((m) => m.id !== monitor.id) })); if (editingId === monitor.id) setEditingId(null); }}><Trash2 size={14} /></button>}</div>
      </div>}
    </div>;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Maple Watch 홈" onClick={(e) => { e.preventDefault(); setModal(null); }}><span className="brand-symbol"><Leaf size={23} fill="currentColor" /></span><span>maple<span className="brand-light">watch</span><small>YOUR PERSONAL COMPANION</small></span></a>
      <div className="workspace-label">워크스페이스 <span>PERSONAL</span></div>
      <nav><button className={!modal ? 'active' : ''} onClick={() => setModal(null)}><LayoutDashboard size={17} />대시보드<span className="nav-mark" /></button><button className={modal === 'settings' ? 'active' : ''} onClick={() => setModal('settings')}><Settings2 size={17} />알림 설정</button><button className={modal === 'guide' ? 'active' : ''} onClick={() => setModal('guide')}><CircleHelp size={17} />사용 가이드<ArrowDownLeft size={13} className="nav-arrow" /></button></nav>
      <div className="sidebar-tip"><div className="mini-leaf"><Leaf size={19} /></div><strong>조금 더 편안한 사냥</strong><p>타이밍은 맡겨두고,<br />나만의 페이스로 즐기세요.</p><span>MADE FOR MAPLERS <span>↗</span></span></div>
      <div className="sidebar-bottom"><div className="local-dot" /><div><strong>내 브라우저에서만 처리</strong><small>화면 영상은 전송되지 않아요</small></div><ShieldCheck size={16} /></div>
      <div className="sidebar-version"><span>MAPLE WATCH</span><span>v0.1.0 BETA</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">워크스페이스<ChevronRight size={13} /><strong>대시보드</strong></div><div className="topbar-right"><span className="privacy"><ShieldCheck size={13} />프라이버시 우선</span><span className="topbar-separator" /><button className="icon-button" aria-label="알림 설정 열기" onClick={() => setModal('settings')}><Bell size={17} /></button><span className="avatar">M</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">A LITTLE HELP, A BETTER HUNT.</div><h1>사냥에만 집중하세요<span>.</span></h1><p>룬부터 버프까지, 놓치기 쉬운 순간을 함께 챙겨요.</p></div><button className="button guide-button" onClick={() => setModal('guide')}><CircleHelp size={14} />처음이신가요?<ArrowRight size={13} /></button></div>
        <div className="mode-toolbar"><div className="mode-tabs" aria-label="감시 모드"><button disabled={sharingState === 'requesting'} className={mode === 'demo' ? 'selected' : ''} onClick={() => changeMode('demo')}><FlaskConical size={14} />데모 모드<span>TRY IT</span></button><button disabled={sharingState === 'requesting'} className={mode === 'live' ? 'selected' : ''} onClick={() => changeMode('live')}><MonitorIcon size={14} />실제 화면</button></div><div className="mode-note"><span className={`status-dot ${mode === 'demo' || stream ? 'green' : ''}`} />{mode === 'demo' ? '샘플 없이 먼저 체험해 보세요' : stream ? '화면 공유 연결됨 · 로컬 처리 중' : sharingState === 'ended' ? '화면 공유가 종료되었습니다' : '화면 공유 대기 중'}</div></div>
        {shareError && <div role="alert" className="error-banner"><MonitorIcon size={16} /><span>{shareError}</span><button className="icon-button" aria-label="공유 오류 닫기" onClick={() => setShareError('')}><X size={15} /></button></div>}
        {!storageOK && <div role="alert" className="error-banner">설정을 저장하지 못했습니다. 브라우저 저장 공간 및 개인정보 보호 설정을 확인해 주세요.</div>}
        <div className="dashboard-grid">
          <div className="main-column">
            <section className="panel preview-panel"><div className="panel-heading"><div><MonitorIcon size={16} /><h2>화면 미리보기</h2><span className={`badge ${mode === 'demo' ? 'demo' : stream ? 'live' : ''}`}>{mode === 'demo' ? 'DEMO' : stream ? 'LIVE' : 'OFFLINE'}</span></div><span className="small-muted">{mode === 'demo' ? '가상의 메이플 월드' : stream ? '공유 중인 화면' : '연결된 화면 없음'}</span></div>
              <ScreenPreview mode={mode} stream={stream} monitors={settings.monitors} editingId={editingId} onSelectMonitor={setEditingId} onRoiChange={setRoi} onVideoReady={(video) => { videoRef.current = video; }} demoRunning={demoRunning} />
              <div className="preview-controls"><div className="preview-state"><span className={`status-dot ${mode === 'demo' && demoRunning || stream ? 'green' : ''}`} /><strong>{mode === 'demo' ? demoRunning ? '데모 재생 중' : '데모 일시정지' : stream ? '화면 공유 중' : sharingState === 'ended' ? '공유 종료됨' : '화면 연결 대기'}</strong><span>{mode === 'demo' ? '실제 감지 결과가 아닙니다' : '화면은 서버에 저장되지 않습니다'}</span></div><div className="preview-buttons">{mode === 'demo' ? <button className="icon-button" onClick={toggleDemo} aria-label={demoRunning ? '데모 일시정지' : '데모 재생'}>{demoRunning ? <Pause size={16} /> : <Play size={16} />}</button> : stream ? <button className="button small" onClick={() => { stopSharing(); log('화면 공유를 종료했습니다.'); }}><Square size={12} />공유 종료</button> : <button className="button primary small" onClick={() => void startSharing()} disabled={sharingState === 'requesting'}><MonitorUp size={14} />{sharingState === 'requesting' ? '화면 선택 중…' : '화면 공유 시작'}</button>}<button className={`icon-button ${editingId ? 'highlight' : ''}`} aria-label="인식 영역 편집" onClick={() => setEditingId(editingId ? null : settings.monitors.find((m) => m.enabled)?.id ?? settings.monitors[0]?.id ?? null)}><Maximize size={16} /></button></div></div>
            </section>
            <section className="panel roi-panel"><div className="roi-intro"><span className="outlined-icon"><Focus size={20} /></span><div><h2>어디를 살펴볼까요?</h2><p>모듈을 선택하고 화면을 드래그해 인식 영역을 지정하세요.</p></div><span className="step-number">01 — 04</span></div><div className="roi-chips">{settings.monitors.map((m) => <button key={m.id} className={`roi-chip ${editingId === m.id ? 'selected' : ''}`} onClick={() => setEditingId(editingId === m.id ? null : m.id)}><span className={`chip-dot ${moduleMeta[m.kind].className}`} />{m.name}{m.roi ? <Check size={12} /> : <Plus size={12} />}</button>)}</div>
              {editingMonitor && <div className="roi-editor"><div className="roi-edit-title"><Crosshair size={14} /><strong>{editingMonitor.name}</strong><span>드래그로 그리기 · 영역 안에서 이동</span><button className="icon-button" aria-label="영역 편집 완료" onClick={() => setEditingId(null)}><Check size={16} /></button></div><div className="roi-coordinates">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{{ x: 'X', y: 'Y', width: '너비', height: '높이' }[key]}<div><input aria-label={`ROI ${key} (%)`} type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={100} step={.1} value={Number(((editingMonitor.roi?.[key] ?? (key === 'width' || key === 'height' ? .2 : .1)) * 100).toFixed(1))} onChange={(e) => setRoi(editingMonitor.id, { ...(editingMonitor.roi ?? { x: .1, y: .1, width: .2, height: .2 }), [key]: Number(e.target.value) / 100 })} /><span>%</span></div></label>)}</div><p>공유 화면의 비율로 저장됩니다. 창 크기나 해상도가 바뀌면 영역을 다시 확인해 주세요.</p></div>}
            </section>
            <div className="demo-notice"><FlaskConical size={19} /><div><strong>{mode === 'demo' ? '안심하고 둘러보는 데모 모드' : '정확도보다 먼저, 투명하게'}</strong><p>{mode === 'demo' ? '타이머와 알림은 가상 이벤트로 작동해요. 실제 게임 화면 인식과는 다릅니다.' : '룬·버프·부스터 자동 인식은 샘플 준비 중이에요. 경험치 픽셀 감시는 실험 기능입니다.'}</p></div><span className="notice-sparkle">✦</span></div>
            <section className="panel activity-panel"><div className="panel-heading"><div><AudioLines size={16} /><h2>활동 기록</h2><span className="count-badge">{logs.length}</span></div><button className="text-button" onClick={() => setLogs([])} disabled={!logs.length}>기록 지우기</button></div><div className="activity-list" aria-live="polite">{logs.length ? logs.slice(0, 4).map((entry) => <div className="activity-row" key={entry.id}><span className={`log-dot ${entry.tone}`} /><time>{new Date(entry.time).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{entry.message}</p></div>) : <p className="empty-log">아직 기록이 없습니다. 감지 이벤트가 이곳에 표시됩니다.</p>}</div></section>
          </div>
          <aside className="modules-column"><div className="modules-heading"><h2>모니터링 모듈 <span>{activeCount}</span></h2><span>각각 독립적으로 작동해요</span></div>{(['rune', 'buff', 'exp', 'booster'] as const).map((kind) => { const meta = moduleMeta[kind]; const Icon = meta.icon; return <section className={`panel module-panel ${meta.className}`} key={kind}><div className="module-heading"><span className={`module-icon ${meta.className}`}><Icon size={17} /></span><div><h3>{meta.title}</h3><p>{meta.sub}</p></div>{kind === 'buff' && <button className="icon-button add-buff" aria-label="새 버프 추가" onClick={addBuff}><Plus size={17} /></button>}</div>{settings.monitors.filter((m) => m.kind === kind).map(renderMonitor)}{kind === 'buff' && !settings.monitors.some((m) => m.kind === 'buff') && <button className="button empty-buff" onClick={addBuff}><Plus size={14} />첫 버프 등록하기</button>}</section>; })}</aside>
        </div>
        <footer><span><ShieldCheck size={13} />게임 메모리 접근 없이, 화면만 살펴봅니다.</span><span>나만의 페이스, 나만의 메이플.<Leaf size={12} /></span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Bell size={16} /><span>{toast}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setToast('')}><X size={14} /></button></div>}
    {modal && <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}><Modal title={modal === 'settings' ? '나에게 맞는 알림' : 'Maple Watch 시작하기'} onClose={() => setModal(null)}>
      {modal === 'settings' ? <><p className="modal-description">중요한 순간을 놓치지 않도록. 설정은 이 브라우저에 자동 저장됩니다.</p><div className="settings-row"><div><strong>소리 알림</strong><p>타이머 종료와 경험치 정체 시 알려드려요</p></div><Toggle checked={settings.soundEnabled} onChange={() => setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }))} label="소리 알림 활성화" /></div><label className="volume-label">알림 음량<span>{Math.round(settings.volume * 100)}%</span><div><VolumeX size={16} /><input type="range" min={0} max={1} step={.01} value={settings.volume} onChange={(e) => setSettings((s) => ({ ...s, volume: Number(e.target.value) }))} aria-label="알림 음량" /><Volume2 size={17} /></div></label><div className="sound-test"><button className="button primary" onClick={async () => { if (await playSound(true)) notify('테스트 소리를 재생했습니다. 이 탭의 소리 알림이 활성화되었습니다.'); }}><Volume2 size={15} />알림 소리 테스트</button><span className={audioReady ? 'text-green' : ''}>{audioReady ? '소리 사용 준비 완료' : '한 번 눌러 소리를 허용해 주세요'}</span></div><div className="setting-note"><Bell size={17} /><p>알림음은 부드러운 3음 차임입니다. 각 모듈 이름을 눌러 지속 시간과 미리 알림 시간을 바꿀 수 있어요. 경험치는 설정 시간 동안 변화가 없을 때 알립니다.</p></div><p className="modal-footnote">브라우저나 탭을 닫으면 알림이 중단됩니다. 백그라운드 탭과 절전 상태에서는 브라우저 정책으로 알림이 지연될 수 있습니다.</p></> : <><p className="modal-description">설치도, 게임 계정 연결도 필요 없어요.</p><ol className="guide-steps"><li><span>01</span><div><strong>먼저 데모로 둘러보기</strong><p>가상 화면에서 영역을 그려보고, 모듈 이름을 눌러 ‘가상 감지’로 타이머를 새로 시작해 보세요.</p></div></li><li><span>02</span><div><strong>Chrome에서 화면 공유하기</strong><p>‘실제 화면’에서 게임 창이나 화면을 선택하세요. HTTPS 또는 localhost가 필요하며, 게임 창을 최소화하면 프레임이 멈출 수 있어요.</p></div></li><li><span>03</span><div><strong>모듈별로 인식 영역 지정하기</strong><p>모듈을 선택한 뒤 미리보기를 드래그하세요. 영역 안을 드래그해 이동하거나 수치로 정밀하게 수정할 수 있습니다.</p></div></li><li><span>04</span><div><strong>인식 기능의 현재 범위 확인하기</strong><p>룬·버프·부스터는 샘플이 없어 자동 인식하지 않습니다. 경험치는 숫자 판독 없이 ROI 픽셀 변화만 실험적으로 감시합니다. 오탐과 누락이 있을 수 있어요.</p></div></li></ol><div className="setting-note"><ShieldCheck size={20} /><p>영상은 브라우저 메모리에서만 처리합니다. 게임 메모리 접근, 자동 키 입력, 게임 조작 기능은 없습니다.</p></div></>}
    </Modal></div>}
    <div className="audio-dock"><span className="status-dot green" />{mode === 'demo' ? 'DEMO SESSION' : stream ? 'LIVE SESSION' : 'LOCAL WORKSPACE'}<span className="session-clock">{formatTime((now - sessionStarted.current) / 1000)}</span><button onClick={() => { if (!audioReady) { setSettings((s) => ({ ...s, soundEnabled: true })); void playSound(true); } else setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled })); }} aria-label={!audioReady ? '소리 알림 활성화' : settings.soundEnabled ? '소리 끄기' : '소리 켜기'}>{settings.soundEnabled && audioReady ? <Volume2 size={14} /> : <VolumeX size={14} />}<span>{!audioReady ? '소리 활성화' : settings.soundEnabled ? '소리 켜짐' : '음소거'}</span></button></div>
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
      const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], [tabindex="0"]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div className="eyebrow">MAKE IT YOURS</div><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="창 닫기" onClick={onClose}><X size={20} /></button></div>{children}<div className="modal-actions"><span><Check size={13} />설정 자동 저장</span><button className="button" onClick={onClose}>완료<ArrowRight size={14} /></button></div></div>;
}
