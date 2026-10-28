import { findCountdownBox, readCountdown } from './countdown'
self.onmessage=event=>{
  const {frame,roi,cached}=event.data
  try{
    const box=findCountdownBox(frame,roi,cached)
    self.postMessage({box,reading:box?readCountdown(frame,box):null})
  }catch{self.postMessage({error:'남은시간 분석 실패 · 알림 보류'})}
}
