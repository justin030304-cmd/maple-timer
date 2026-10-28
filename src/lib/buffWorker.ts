import { matchBuffs } from './buffs'
import type { PixelFrame } from './analysis'
const context=self as unknown as {onmessage:((event:MessageEvent<{id:number;frame:PixelFrame;templates:PixelFrame}>)=>void)|null;postMessage:(value:unknown)=>void}
context.onmessage=event=>{
  try{context.postMessage({id:event.data.id,matches:matchBuffs(event.data.frame,event.data.templates)})}
  catch{context.postMessage({id:event.data.id,error:'버프 아이콘 분석에 실패했습니다.'})}
}
