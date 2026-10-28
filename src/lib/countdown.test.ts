import { describe, expect, it } from 'vitest'
import { advanceCountdown, emptyCountdownClock, takeCountdownAlert } from './countdown'
import { timerRuntime } from './engine'
import type { Monitor } from '../types'
const monitor:Monitor={id:'countdown',name:'남은시간',kind:'countdown',enabled:true,roi:null,durationSec:999,warnBeforeSec:10}
function confirmed(start=12,now=0){let c=emptyCountdownClock();for(let i=0;i<3;i++)c=advanceCountdown(c,start-i*.3,now+i*300);return c}
describe('observed decimal countdown',()=>{
  it('requires two real decreases and never arms from a still screenshot',()=>{
    let c=emptyCountdownClock()
    for(let n=0;n<20;n++)c=advanceCountdown(c,5,n*300)
    expect(c.valid).toBe(false);expect(takeCountdownAlert(c,10,6000)).toBe(false)
    expect(confirmed().valid).toBe(true)
  })
  it('alerts once at the configured threshold and does not repeat at expiry',()=>{
    let c=confirmed()
    expect(takeCountdownAlert(c,10,600)).toBe(false)
    for(let t=900;t<=12300;t+=300){c=advanceCountdown(c,Math.max(0,12-t/1000),t);if(t===2100)expect(takeCountdownAlert(c,10,t)).toBe(true);else expect(takeCountdownAlert(c,10,t)).toBe(false)}
  })
  it('preserves the one-shot latch through unreadable frames and recovery',()=>{
    let c=confirmed(9);expect(takeCountdownAlert(c,10,600)).toBe(true)
    c=advanceCountdown(c,null,900)
    for(let t=1200;t<=1800;t+=300)c=advanceCountdown(c,9-t/1000,t)
    expect(c.valid).toBe(true);expect(takeCountdownAlert(c,10,1800)).toBe(false)
  })
  it('rearms only after a new countdown has consistent decreasing reads',()=>{
    let c=confirmed(9);expect(takeCountdownAlert(c,10,600)).toBe(true)
    for(let n=0;n<3;n++)c=advanceCountdown(c,15-n*.3,900+n*300)
    expect(c.cycle).toBe(2);expect(c.alerted).toBe(false)
    expect(takeCountdownAlert(c,14,2000)).toBe(true)
  })
  it('rejects jumps, nonfinite values, frozen numbers and stale reads',()=>{
    for(const bad of [null,NaN,Infinity,-1,1000])expect(advanceCountdown(confirmed(),bad,900).valid).toBe(false)
    expect(advanceCountdown(confirmed(),20,900).valid).toBe(false)
    const c=confirmed(10);expect(advanceCountdown(c,c.lastSeconds,900).valid).toBe(false)
    expect(takeCountdownAlert(c,10,5000)).toBe(false)
  })
  it('uses automatic detection with no saved ROI and stops when the source ends',()=>{
    const c=confirmed(10),options={expIdleSec:60,hasSource:true,countdown:{...c,detail:'실제 숫자 추적'}}
    expect(timerRuntime(monitor,null,600,options).status).toBe('warning')
    expect(timerRuntime(monitor,null,600,{...options,hasSource:false}).status).toBe('waiting')
    expect(timerRuntime(monitor,null,600,{...options,countdown:{...options.countdown,valid:false}}).status).toBe('waiting')
  })
})
