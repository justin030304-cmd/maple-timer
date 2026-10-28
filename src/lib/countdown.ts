import type { PixelFrame } from './analysis'
import type { ROI } from '../types'
import { COUNTDOWN_DIGITS, COUNTDOWN_HEADER } from './countdownModel'

export interface CountdownBox { x:number; y:number; scale:number }
export interface CountdownReading { seconds:number; box:CountdownBox; roi:ROI; score:number }
const white=(f:PixelFrame,x:number,y:number)=>{
  x=Math.round(x);y=Math.round(y)
  if(x<0||y<0||x>=f.width||y>=f.height)return false
  const i=(y*f.width+x)*4
  return Math.min(f.data[i],f.data[i+1],f.data[i+2])>145
}
const points:{x:number;y:number;on:boolean}[]=[]
for(let y=1;y<17;y+=2)for(let x=1;x<67;x+=2)points.push({x,y,on:COUNTDOWN_HEADER[y*68+x]==='1'})
const positive=points.filter(p=>p.on),negative=points.filter(p=>!p.on)
function headerScore(frame:PixelFrame,box:CountdownBox,coarse=false){
  const stride=coarse?5:1
  let yes=0,no=0,ny=0,nn=0
  for(let i=0;i<positive.length;i+=stride){const p=positive[i];ny++;if(white(frame,box.x+p.x*box.scale,box.y+p.y*box.scale))yes++}
  for(let i=0;i<negative.length;i+=stride){const p=negative[i];nn++;if(!white(frame,box.x+p.x*box.scale,box.y+p.y*box.scale))no++}
  return (yes/ny+no/nn)/2
}

/** Finds the static clock/남은시간 label, rather than treating arbitrary digits as a timer. */
export function findCountdownBox(frame:PixelFrame,roi:ROI|null=null,cached?:CountdownBox|null):CountdownBox|null{
  if(cached&&headerScore(frame,cached)>(cached.scale<1?.8:.88))return cached
  const region=roi??{x:.25,y:0,width:.5,height:.32}
  const left=Math.max(0,Math.floor(region.x*frame.width)),top=Math.max(0,Math.floor(region.y*frame.height))
  const right=Math.min(frame.width,(region.x+region.width)*frame.width),bottom=Math.min(frame.height,(region.y+region.height)*frame.height)
  const candidates:{box:CountdownBox;score:number}[]=[]
  for(const scale of [1,1.25,.8,1.5,.65,2,.5]){
    const step=Math.max(1,Math.floor(scale))
    for(let y=top;y<bottom-18*scale;y+=step)for(let x=left;x<right-68*scale;x+=step){
      const box={x,y,scale}
      if(headerScore(frame,box,true)<.79)continue
      const score=headerScore(frame,box)
      if(score<.8)continue
      if(score>(scale<1?.82:.94)&&readCountdown(frame,box))return box
      if(candidates.length<8||score>candidates[candidates.length-1].score){candidates.push({box,score});candidates.sort((a,b)=>b.score-a.score);candidates.length=Math.min(8,candidates.length)}
    }
  }
  let best:CountdownBox|null=null,bestScore=.8
  for(const {box} of candidates)for(const ds of [-.06,0,.06])for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const candidate={x:box.x+dx,y:box.y+dy,scale:box.scale+ds},score=headerScore(frame,candidate)
    if(score>bestScore&&readCountdown(frame,candidate)){bestScore=score;best=candidate}
  }
  return best
}

/** Decimal seconds in this reference use seven-segment glyphs, not mm:ss. */
export function readCountdown(frame:PixelFrame,box:CountdownBox):CountdownReading|null{
  if(headerScore(frame,box)<(box.scale<1?.8:.85))return null
  const w=84,h=32,mask:number[][]=[]
  for(let y=0;y<h;y++){
    const row:number[]=[]
    for(let x=0;x<w;x++){
      const px=Math.round(box.x+(86+x)*box.scale),py=Math.round(box.y+(1+y)*box.scale)
      if(px<0||py<0||px>=frame.width||py>=frame.height){row.push(0);continue}
      const i=(py*frame.width+px)*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
      row.push(Number(Math.min(r,g)>145&&b<Math.min(r,g)+35&&Math.abs(r-g)<85))
    }
    mask.push(row)
  }
  const groups:number[][]=[]
  for(let x=0;x<w;x++)if(mask.some(row=>row[x])){
    if(!groups.length||x>groups[groups.length-1].at(-1)!+1)groups.push([])
    groups.at(-1)!.push(x)
  }
  let text='',quality=1
  for(const xs of groups){
    const ys=mask.flatMap((row,y)=>xs.some(x=>row[x])?[y]:[]),x=xs[0],y=ys[0],height=ys.at(-1)!-y+1,width=xs.length
    if(height<=8&&width<=8&&y>=23){text+='.';continue}
    if(height<21||width>20)return null
    const bits=Array.from({length:180},(_,i)=>mask[y+Math.min(height-1,Math.floor((Math.floor(i/10)+.5)*height/18))][x+Math.min(width-1,Math.floor((i%10+.5)*width/10))])
    const scores=Array.from({length:10},(_,digit)=>({digit,score:Math.max(...COUNTDOWN_DIGITS.filter(m=>m.digit===digit).map(m=>1-bits.reduce((sum,bit,i)=>sum+Math.abs(bit-Number(m.mask[i])),0)/180-Math.abs(width/height-m.aspect)*.18))})).sort((a,b)=>b.score-a.score)
    if(scores[0].score<.84||scores[0].score-scores[1].score<.025)return null
    text+=scores[0].digit;quality=Math.min(quality,scores[0].score)
  }
  if(!/^\d{1,3}\.\d{2}$/.test(text))return null
  const seconds=Number(text),{scale}=box
  return {seconds,box,score:quality,roi:{x:(box.x-8*scale)/frame.width,y:(box.y-8*scale)/frame.height,width:204*scale/frame.width,height:54*scale/frame.height}}
}

export interface CountdownClock { expiresAt:number|null; lastReadAt:number|null; lastSeconds:number|null; pendingEnd:number|null; confirmations:number; valid:boolean; cycle:number; alerted:boolean }
export const emptyCountdownClock=():CountdownClock=>({expiresAt:null,lastReadAt:null,lastSeconds:null,pendingEnd:null,confirmations:0,valid:false,cycle:0,alerted:false})
export function advanceCountdown(previous:CountdownClock,seconds:number|null,now:number):CountdownClock{
  if(seconds===null||!Number.isFinite(seconds)||seconds<0||seconds>=1000)return {...previous,valid:false,confirmations:0,pendingEnd:null}
  const end=now+seconds*1000,gap=previous.lastReadAt===null?Infinity:now-previous.lastReadAt
  const consistent=gap<2500&&previous.pendingEnd!==null&&Math.abs(end-previous.pendingEnd)<650&&previous.lastSeconds!==null&&seconds<previous.lastSeconds-.05
  if(!consistent)return {...previous,lastReadAt:now,lastSeconds:seconds,pendingEnd:end,confirmations:0,valid:false}
  const confirmations=previous.confirmations+1,valid=confirmations>=2
  const sameCycle=previous.expiresAt!==null&&Math.abs(end-previous.expiresAt)<1800
  return {lastReadAt:now,lastSeconds:seconds,pendingEnd:end,confirmations,valid,expiresAt:valid?(sameCycle?previous.expiresAt:end):previous.expiresAt,cycle:previous.cycle+(valid&&!sameCycle?1:0),alerted:sameCycle?previous.alerted:false}
}
export function takeCountdownAlert(clock:CountdownClock,threshold:number,now:number):boolean{
  if(!clock.valid||clock.alerted||clock.expiresAt===null||clock.lastReadAt===null||now-clock.lastReadAt>2000||(clock.expiresAt-now)/1000>threshold)return false
  clock.alerted=true
  return true
}
