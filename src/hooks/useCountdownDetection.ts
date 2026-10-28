import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Monitor, ROI } from '../types'
import { advanceCountdown, emptyCountdownClock, takeCountdownAlert } from '../lib/countdown'
import type { CountdownBox, CountdownClock, CountdownReading } from '../lib/countdown'
export interface CountdownObservation { valid:boolean; expiresAt:number|null; lastReadAt:number|null; detail:string; seconds:number|null; roi:ROI|null; error?:string }
export function useCountdownDetection({stream,videoRef,monitor,onAlert}:{stream:MediaStream|null;videoRef:RefObject<HTMLVideoElement|null>;monitor?:Monitor;onAlert:(monitor:Monitor)=>void}){
  const [observation,setObservation]=useState<CountdownObservation>()
  const latest=useRef({monitor,onAlert});latest.current={monitor,onAlert}
  const session=useRef<{source:MediaStream|null;clock:CountdownClock}>({source:null,clock:emptyCountdownClock()})
  const roiKey=JSON.stringify(monitor?.roi)
  useEffect(()=>{
    setObservation(undefined)
    if(session.current.source!==stream)session.current={source:stream,clock:emptyCountdownClock()}
    if(!stream||!monitor?.enabled)return
    session.current.clock={...session.current.clock,valid:false,pendingEnd:null,confirmations:0}
    let disposed=false,timer:ReturnType<typeof setTimeout>,timeout:ReturnType<typeof setTimeout>,cached:CountdownBox|null=null
    const worker=new Worker(new URL('../lib/countdownWorker.ts',import.meta.url),{type:'module'})
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true})!
    const fail=(message:string)=>{
      if(disposed)return
      session.current.clock=advanceCountdown(session.current.clock,null,Date.now())
      setObservation({valid:false,expiresAt:null,lastReadAt:null,seconds:null,roi:null,detail:message,error:message})
    }
    const sample=()=>{
      if(disposed)return
      const video=videoRef.current
      if(!video||video.readyState<2){timer=setTimeout(sample,500);return}
      try{
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.drawImage(video,0,0)
        const frame=ctx.getImageData(0,0,canvas.width,canvas.height),capturedAt=Date.now()
        timeout=setTimeout(()=>{worker.terminate();fail('남은시간 분석 지연 · 모듈을 껐다 다시 켜 주세요.')},10000)
        worker.onmessage=event=>{
          clearTimeout(timeout)
          if(disposed)return
          if(event.data.error){fail(event.data.error);timer=setTimeout(sample,1000);return}
          const {reading,box}=event.data as {reading:CountdownReading|null;box:CountdownBox|null}
          cached=box
          const clock=advanceCountdown(session.current.clock,reading?.seconds??null,capturedAt);session.current.clock=clock
          setObservation({valid:clock.valid,expiresAt:clock.expiresAt,lastReadAt:clock.lastReadAt,seconds:reading?.seconds??null,roi:reading?.roi??null,detail:clock.valid?'소수점 초 감소 확인 · 종료 추적 중':reading?'남은시간 감소를 연속 확인 중':box?'남은시간 숫자 판독 실패 · 알림 보류':'상단 중앙 남은시간 박스 찾는 중 · 못 찾으면 영역을 지정해 주세요'})
          const current=latest.current.monitor
          if(current?.enabled&&takeCountdownAlert(clock,current.warnBeforeSec,Date.now()))latest.current.onAlert(current)
          timer=setTimeout(sample,box?300:1000)
        }
        worker.postMessage({frame,roi:latest.current.monitor?.roi??null,cached},[frame.data.buffer])
      }catch{fail('공유 화면을 읽지 못했습니다 · 알림 보류');timer=setTimeout(sample,1000)}
    }
    worker.onerror=()=>{clearTimeout(timeout);fail('남은시간 분석기가 중단되었습니다. 모듈을 껐다 다시 켜 주세요.')}
    sample()
    return()=>{disposed=true;clearTimeout(timer);clearTimeout(timeout);worker.terminate()}
  },[stream,videoRef,monitor?.id,monitor?.enabled,roiKey])
  return observation
}
