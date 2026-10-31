import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Monitor } from '../types'
import { advanceBuffClock, BUFF_NAMES, clusterBuffAlerts, emptyBuffClock, verifyBuffEdges, recognizeBuffTime, hasWhiteMinuteLabel, advanceBuffIdentity } from '../lib/buffs'
import type { BuffClock, BuffMatch, BuffTimeReading, BuffIdentity } from '../lib/buffs'
import { BUFF_DIGIT_MODEL } from '../lib/buffDigitModel'
import templateURL from '../assets/buff-targets.png'
export interface BuffObservation { clock:BuffClock; detail:string; score:number|null; number:number|null; candidate:BuffMatch|null; time?:BuffTimeReading|null; loading?:boolean; error?:string }

export function useBuffDetection({stream,videoRef,monitors,onAlert}:{stream:MediaStream|null;videoRef:RefObject<HTMLVideoElement|null>;monitors:Monitor[];onAlert:(monitors:Monitor[])=>void}){
  const [observations,setObservations]=useState<Record<string,BuffObservation>>({})
  const latest=useRef({monitors,onAlert});latest.current={monitors,onAlert}
  const session=useRef<{source:MediaStream|null;clocks:Record<string,BuffClock>;targets:Record<string,string>;notified:Set<string>;history:{expiresAt:number;warnBeforeSec:number}[]}>({source:null,clocks:{},targets:{},notified:new Set(),history:[]})
  const key=JSON.stringify(monitors.filter(m=>m.buffTarget).map(m=>[m.id,m.buffTarget,m.enabled,m.roi,m.warnBeforeSec]))
  useEffect(()=>{
    setObservations({})
    if(session.current.source!==stream)session.current={source:stream,clocks:{},targets:{},notified:new Set(),history:[]}
    const targets=latest.current.monitors.filter(m=>m.buffTarget&&m.enabled&&m.roi)
    if(!stream||!targets.length)return
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined
    const {clocks,notified,history}=session.current
    const positions:Record<string,BuffMatch|undefined>={}
    const identities:Record<string,BuffIdentity>={}
    const crop=document.createElement('canvas'),ctx=crop.getContext('2d',{willReadFrequently:true})!
    const worker=new Worker(new URL('../lib/buffWorker.ts',import.meta.url),{type:'module'})
    let requestId=0,workerError=''
    const pending=new Map<number,{resolve:(matches:BuffMatch[])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
    worker.onmessage=event=>{const job=pending.get(event.data.id);if(!job)return;pending.delete(event.data.id);clearTimeout(job.timer);if(event.data.error)job.reject(new Error(event.data.error));else job.resolve(event.data.matches)}
    worker.onerror=()=>{workerError='버프 분석기가 중단되었습니다. 모듈을 껐다 다시 켜 주세요.';for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error(workerError))}pending.clear()}
    const parse=(frame:ImageData,templates:ImageData)=>new Promise<BuffMatch[]>((resolve,reject)=>{if(workerError){reject(new Error(workerError));return}const id=++requestId;pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);workerError='버프 분석 시간이 초과되었습니다. 영역을 좁히고 모듈을 껐다 다시 켜 주세요.';worker.terminate();reject(new Error(workerError))},15000)});worker.postMessage({id,frame,templates})})
    const sample=async(templates:ImageData)=>{
      const next:Record<string,BuffObservation>={}
      const frames=new Map<string,{image:ImageData;capturedAt:number;matches?:BuffMatch[]}>()
      for(const original of targets){
        if(disposed)return
        const monitor=latest.current.monitors.find(m=>m.id===original.id)??original,roi=monitor.roi!,source=videoRef.current
        let now=Date.now()
        const previous=clocks[monitor.id]??emptyBuffClock()
        try{
          if(!source||source.readyState<2)throw new Error('버프 감시 화면을 읽을 수 없습니다.')
          const scale=Math.min(1,960/(roi.width*source.videoWidth))
          const frameKey=JSON.stringify([roi,source.videoWidth,source.videoHeight])
          let frame=frames.get(frameKey)
          if(!frame){
            crop.width=Math.max(1,Math.round(roi.width*source.videoWidth*scale));crop.height=Math.max(1,Math.round(roi.height*source.videoHeight*scale))
            ctx.drawImage(source,roi.x*source.videoWidth,roi.y*source.videoHeight,roi.width*source.videoWidth,roi.height*source.videoHeight,0,0,crop.width,crop.height)
            frame={image:ctx.getImageData(0,0,crop.width,crop.height),capturedAt:Date.now()};frames.set(frameKey,frame)
          }
          now=frame.capturedAt
          const image=frame.image
          let found=positions[monitor.id]
          if(!found||!verifyBuffEdges(image,templates,found)){
            frame.matches??=await parse(image,templates)
            if(disposed)return
            found=frame.matches.find(match=>match.target===monitor.buffTarget)
          }
          positions[monitor.id]=found
          const identity=advanceBuffIdentity(identities[monitor.id]??{candidate:null,frames:0},found??null);identities[monitor.id]=identity
          const confirmed=identity.frames>=2
          let number:number|null=null,time:BuffTimeReading|null=null,detail=found?'아이콘 확인 · 초 단위 숫자 대기':'대상 아이콘을 찾는 중'
          if(found){
            const result=recognizeBuffTime(image,found,BUFF_DIGIT_MODEL)
            if(result){time=result;number=result.seconds;detail=number>59?`아이콘 감지됨 · ${result.display} 남음 · 59초 이하에서 종료 추적`:'초 단위 감소 확인 중'}else if(hasWhiteMinuteLabel(image,found))detail='분 단위 표시 확인 · 마지막 59초 대기'
            // Keep the location while the icon itself passes this frame's
            // identity check. Unreadable digits invalidate the clock, not the
            // icon; a missing/replaced icon still forces a fresh search above.
            else detail='아이콘 확인 · 시간 판독 대기 · 알림 보류'
          }
          if(!confirmed){number=null;time=null;if(found)detail='아이콘 후보 연속 확인 중 · 알림 보류'}
          const clock=advanceBuffClock(previous,number,now);clocks[monitor.id]=clock
          if(clock.valid)detail='종료 시점 추적 중'
          next[monitor.id]={clock,detail,score:found?.score??null,number,time,candidate:confirmed?found??null:null}
        }catch(error){
          identities[monitor.id]={candidate:null,frames:0}
          clocks[monitor.id]=advanceBuffClock(previous,null,now)
          next[monitor.id]={clock:clocks[monitor.id],detail:'분석 실패 · 알림 보류',score:null,number:null,candidate:null,error:error instanceof Error?error.message:'버프 인식 실패'}
        }
      }
      if(disposed)return
      setObservations(next)
      const now=Date.now(),eligible=targets.filter(m=>{const c=clocks[m.id];return c?.valid&&c.expiresAt!==null&&c.lastReadAt!==null&&now-c.lastReadAt<4000})
      const groups=clusterBuffAlerts(eligible.map(m=>({id:m.id,name:BUFF_NAMES[m.buffTarget!],expiresAt:clocks[m.id].expiresAt!,cycle:clocks[m.id].cycle,warnBeforeSec:m.warnBeforeSec})),now,notified,3000,history)
      for(const group of groups)latest.current.onAlert(group.map(item=>latest.current.monitors.find(m=>m.id===item.id)!).filter(Boolean))
      timer=setTimeout(()=>void sample(templates),800)
    }
    void(async()=>{
      try{
        for(const m of targets){
          const old=clocks[m.id]??emptyBuffClock()
          clocks[m.id]=session.current.targets[m.id]===m.buffTarget?{...old,valid:false,pendingEnd:null,lastNumber:null,drops:0}:{...emptyBuffClock(),cycle:old.cycle}
          session.current.targets[m.id]=m.buffTarget!
        }
        setObservations(Object.fromEntries(targets.map(m=>[m.id,{clock:emptyBuffClock(),detail:'버프 인식 모델 준비 중',score:null,number:null,candidate:null,loading:true}])))
        const img=new Image();img.src=templateURL;await img.decode()
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height
        const context=canvas.getContext('2d')!;context.drawImage(img,0,0)
        const templates=context.getImageData(0,0,canvas.width,canvas.height)
        if(disposed)return
        await sample(templates)
      }catch(error){if(!disposed)setObservations(Object.fromEntries(targets.map(m=>[m.id,{clock:emptyBuffClock(),detail:'버프 인식 모델을 시작하지 못했습니다',score:null,number:null,candidate:null,error:error instanceof Error?error.message:'버프 인식 초기화 실패'}])))}
    })()
    return()=>{disposed=true;clearTimeout(timer);worker.terminate();for(const job of pending.values()){clearTimeout(job.timer);job.resolve([])}pending.clear()}
  },[stream,videoRef,key])
  return observations
}
