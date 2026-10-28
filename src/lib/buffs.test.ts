import { describe,it,expect } from 'vitest'
import { advanceBuffClock,emptyBuffClock,clusterBuffAlerts } from './buffs'
const item=(id:string,end=30000,cycle=1)=>({id,name:id,expiresAt:end,cycle,warnBeforeSec:10})
describe('buff seconds tracking',()=>{
 it('waits for 59 or below and two real second decrements',()=>{
  let state=advanceBuffClock(emptyBuffClock(),60,0);expect(state.valid).toBe(false)
  state=advanceBuffClock(state,59,1000);expect(state.valid).toBe(false)
  state=advanceBuffClock(state,58,2000);expect(state.valid).toBe(false)
  state=advanceBuffClock(state,57,3000);expect(state.valid).toBe(true);expect(state.expiresAt).toBe(60000)
 })
 it('never mistakes a minute number or an unchanged misread for seconds',()=>{
  let state=emptyBuffClock()
  for(let time=0;time<10000;time+=1000)state=advanceBuffClock(state,26,time)
  expect(state.valid).toBe(false)
  state=advanceBuffClock(state,25,60000);expect(state.valid).toBe(false)
 })
 it('invalidates missing/stale frames and rejects speed changes without expiry alerts',()=>{
  let s=advanceBuffClock(emptyBuffClock(),30,0);s=advanceBuffClock(s,29,1000);s=advanceBuffClock(s,28,2000);expect(s.valid).toBe(true)
  expect(advanceBuffClock(s,null,3000).valid).toBe(false)
  expect(advanceBuffClock(s,20,10000).valid).toBe(false)
  expect(advanceBuffClock(s,10,3000).valid).toBe(false)
 })
 it('retains the deadline and cycle through recovery, and rearms on renewal',()=>{
  let s=advanceBuffClock(emptyBuffClock(),20,0);s=advanceBuffClock(s,19,1000);s=advanceBuffClock(s,18,2000);const cycle=s.cycle
  s=advanceBuffClock(s,null,2500);s=advanceBuffClock(s,17,3000);s=advanceBuffClock(s,16,4000);s=advanceBuffClock(s,15,5000)
  expect(s.valid).toBe(true);expect(s.cycle).toBe(cycle)
  s=advanceBuffClock(s,59,6000);s=advanceBuffClock(s,58,7000);s=advanceBuffClock(s,57,8000)
  expect(s.cycle).toBe(cycle+1)
 })
})
describe('buff expiry clustering',()=>{
 it('emits one group at 10 seconds before the earliest endpoint, once per cycle',()=>{
  const sent=new Set<string>(),history:{expiresAt:number;warnBeforeSec:number}[]=[]
  expect(clusterBuffAlerts([item('potion'),item('union',32000)],19999,sent,3000,history)).toHaveLength(0)
  expect(clusterBuffAlerts([item('potion'),item('union',32000)],20000,sent,3000,history)[0]).toHaveLength(2)
  expect(clusterBuffAlerts([item('potion'),item('union',32000)],25000,sent,3000,history)).toHaveLength(0)
 })
 it('separates distant endings and avoids transitive over-grouping',()=>{
  const groups=clusterBuffAlerts([item('a',30000),item('b',32000),item('c',34000)],30000,new Set())
  expect(groups.map(g=>g.map(i=>i.id))).toEqual([['a','b'],['c']])
 })
 it('suppresses a late-recovered member near a group that already alerted',()=>{
  const sent=new Set<string>(),history:{expiresAt:number;warnBeforeSec:number}[]=[]
  expect(clusterBuffAlerts([item('potion')],20000,sent,3000,history)).toHaveLength(1)
  expect(clusterBuffAlerts([item('union',32000)],23000,sent,3000,history)).toHaveLength(0)
  expect(clusterBuffAlerts([item('potion',100000,2)],90000,sent,3000,history)).toHaveLength(1)
 })
})
