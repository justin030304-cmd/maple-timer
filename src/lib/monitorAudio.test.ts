import { describe, expect, it } from 'vitest'
import { defaultMonitorAudio, readMonitorAudio, resolveMonitorAudio } from './monitorAudio'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'

describe('independent monitor audio', () => {
  it('defaults rune to the requested TTS phrase and experience to dingdong', () => {
    expect(defaultMonitorAudio('rune')).toMatchObject({sound:'speech',speechText:'룬 떳어요',voiceURI:''})
    expect(defaultMonitorAudio('exp').sound).toBe('dingdong')
    expect(defaultMonitorAudio('buff').sound).toBe('inherit')
  })
  it('migrates old settings without changing ROIs, mute, or idle thresholds', () => {
    const original = {...DEFAULT_SETTINGS, soundEnabled:false, expIdleSec:37,
      monitors:DEFAULT_SETTINGS.monitors.map(m=>({...m,roi:{x:.1,y:.2,width:.3,height:.1}}))}
    const saved = loadSettings({getItem:()=>JSON.stringify({version:1,settings:original}),setItem:()=>{}})
    expect(saved.soundEnabled).toBe(false);expect(saved.expIdleSec).toBe(37)
    const roi = saved.monitors.find(m=>m.kind==='rune')!.roi!
    expect(roi.x).toBeCloseTo(.1);expect(roi.y).toBeCloseTo(.2);expect(roi.width).toBeCloseTo(.3);expect(roi.height).toBeCloseTo(.1)
    expect(readMonitorAudio(saved.monitors.find(m=>m.kind==='rune')!.audio,'rune').speechText).toBe('룬 떳어요')
    expect(readMonitorAudio(saved.monitors.find(m=>m.kind==='exp')!.audio,'exp').sound).toBe('dingdong')
  })
  it('keeps rune female auto selection independent from a global male voice and chime', () => {
    const profile = resolveMonitorAudio({...DEFAULT_SETTINGS,notificationSound:'chime',voiceURI:'male'},'event',DEFAULT_SETTINGS.monitors[0])
    expect(profile).toMatchObject({sound:'speech',text:'룬 떳어요',voiceURI:''})
  })
  it('multiplies individual volume by master volume and honors inheritance', () => {
    const monitor = {...DEFAULT_SETTINGS.monitors[0],audio:{...defaultMonitorAudio('rune'),sound:'inherit' as const,volume:.4}}
    expect(resolveMonitorAudio({...DEFAULT_SETTINGS,volume:.5,voiceURI:'saved'},'event',monitor)).toMatchObject({volume:.2,voiceURI:'saved',text:'event'})
  })
  it('bounds corrupt audio values and preserves explicit empty text for event messages', () => {
    expect(readMonitorAudio({sound:'garbage',volume:8,voiceURI:3,speechText:''},'rune')).toMatchObject({sound:'speech',volume:1,voiceURI:'',speechText:''})
    expect(readMonitorAudio({volume:NaN},'exp').volume).toBe(1)
    expect(resolveMonitorAudio(DEFAULT_SETTINGS,'detected',{...DEFAULT_SETTINGS.monitors[0],audio:{...defaultMonitorAudio('rune'),speechText:''}}).text).toBe('detected')
  })
  it('persists different audio profiles for two buff regions', () => {
    let raw = ''
    const storage = {getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value}}
    const settings = {...DEFAULT_SETTINGS,monitors:[...DEFAULT_SETTINGS.monitors,
      {id:'buff-exp',name:'비약',kind:'buff' as const,buffTarget:'potion' as const,roi:{x:.5,y:0,width:.5,height:.5},enabled:true,durationSec:60,warnBeforeSec:10,audio:{...defaultMonitorAudio('buff'),sound:'silent' as const}},
      {id:'buff-drop',name:'유니온의 부',kind:'buff' as const,buffTarget:'union-wealth' as const,roi:{x:.5,y:0,width:.5,height:.5},enabled:true,durationSec:60,warnBeforeSec:10},
    ]}
    expect(saveSettings(settings,storage)).toBe(true)
    const result = loadSettings(storage)
    expect(result.monitors.find(m=>m.id==='buff-exp')!.audio!.sound).toBe('silent')
    expect(readMonitorAudio(result.monitors.find(m=>m.id==='buff-drop')!.audio,'buff').sound).toBe('inherit')
  })
})
