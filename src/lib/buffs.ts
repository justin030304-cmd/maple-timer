import { BUFF_OVERLAY_DIGITS } from './buffOverlayDigitModel'
import { BUFF_DIGIT_MODEL } from './buffDigitModel'
import type { PixelFrame } from './analysis'
export type BuffTarget = 'potion' | 'union-wealth'
export const BUFF_NAMES: Record<BuffTarget,string> = {potion:'비약','union-wealth':'유니온의 부'}
export interface BuffMatch { target: BuffTarget; x:number; y:number; size:number; score:number }
const points = [ .14,.35,.56,.77,.9 ]
function score(frame:PixelFrame, template:PixelFrame, tile:number,x:number,y:number,size:number, fine=false) {
  let difference=0,count=0
  const ys=fine?[.08,.16,.24,.32,.4,.48,.56,.64,.72,.8,.88]:[.12,.32,.52,.64]
  for(const py of ys)for(const px of points){
    if(fine&&py>=.64&&px<.45)continue
    const i=(Math.min(frame.height-1,y+Math.floor(py*size))*frame.width+x+Math.floor(px*size))*4
    const t=(Math.floor(py*32)*template.width+tile*32+Math.floor(px*32))*4
    for(let c=0;c<3;c++){difference+=Math.abs(frame.data[i+c]-template.data[t+c]);count++}
  }
  return 1-difference/(count*255)
}
function edgeScore(frame:PixelFrame,templates:PixelFrame,tile:number,x:number,y:number,size:number):number{
  let error=0,count=0
  for(const [px,py] of [[.12,.1],[.3,.1],[.5,.1],[.7,.1],[.9,.1],[.9,.72],[.9,.88],[.7,.88],[.5,.88]]){
    const i=((y+Math.floor(py*size))*frame.width+x+Math.floor(px*size))*4,j=(Math.floor(py*32)*templates.width+tile*32+Math.floor(px*32))*4
    for(let c=0;c<3;c++){error+=Math.abs(frame.data[i+c]-templates.data[j+c]);count++}
  }
  return 1-error/(count*255)
}
/** Parser proposes icon rectangles at several UI sizes; matcher compares the
 * two references and their lookalike neighbours, excluding the minute text. */
export function matchBuffs(frame:PixelFrame, templates:PixelFrame):BuffMatch[]{
  const result:BuffMatch[]=[]
  for(let tile=0;tile<2;tile++){
    let best:BuffMatch|null=null
    for(const size of [20,24,28,30,32,34,36,40,44,48,56,64]){
      if(size>frame.width||size>frame.height)continue
      const step=Math.max(2,Math.round(size/8)),proposals:{x:number;y:number;score:number}[]=[]
      for(let y=0;y<=frame.height-size;y+=step)for(let x=0;x<=frame.width-size;x+=step){
        const value=Math.max(score(frame,templates,tile,x,y,size),edgeScore(frame,templates,tile,x,y,size)-.02)
        if(value<.72)continue
        if(proposals.length<20||value>proposals[proposals.length-1].score){
          proposals.push({x,y,score:value});proposals.sort((a,b)=>b.score-a.score);if(proposals.length>20)proposals.pop()
        }
      }
      for(const candidate of proposals)for(let dy=-step;dy<=step;dy++)for(let dx=-step;dx<=step;dx++){
        const x=candidate.x+dx,y=candidate.y+dy
        if(x<0||y<0||x+size>frame.width||y+size>frame.height)continue
        const full=score(frame,templates,tile,x,y,size,true),edge=edgeScore(frame,templates,tile,x,y,size)
        const fullMatch=full>=.86&&full-score(frame,templates,tile+2,x,y,size,true)>=.012
        const partialMatch=edge>=.91&&edge-edgeScore(frame,templates,tile+2,x,y,size)>=.02
        const value=Math.max(fullMatch?full:0,partialMatch?edge-.01:0)
        if(!value||best&&value<=best.score)continue
        if(!fullMatch&&!recognizeBuffTime(frame,{x,y,size},BUFF_DIGIT_MODEL))continue
        best={target:tile===0?'potion':'union-wealth',x,y,size,score:value}
      }
    }
    if(best)result.push(best)
  }
  return result
}

export interface BuffClock { expiresAt:number|null; lastReadAt:number|null; pendingEnd:number|null; lastNumber:number|null; drops:number; valid:boolean; cycle:number; error:string|null }
export const emptyBuffClock=():BuffClock=>({expiresAt:null,lastReadAt:null,pendingEnd:null,lastNumber:null,drops:0,valid:false,cycle:0,error:null})
/** An icon/minute label alone never starts a clock. Require two observed second
 * decrements with a consistent deadline; unreadable or stale samples cannot alert. */
export function advanceBuffClock(previous:BuffClock,seconds:number|null,now:number):BuffClock{
  const next={...previous,valid:false,lastReadAt:now,error:null}
  if(seconds===null||!Number.isInteger(seconds)||seconds<0||seconds>59){return {...next,pendingEnd:null,lastNumber:null,drops:0}}
  const end=now+seconds*1000
  const fresh=previous.lastReadAt!==null&&now-previous.lastReadAt<=4000&&now>=previous.lastReadAt
  const consistent=fresh&&previous.pendingEnd!==null&&Math.abs(end-previous.pendingEnd)<=1800&&previous.lastNumber!==null&&seconds<=previous.lastNumber
  if(!consistent)return {...next,pendingEnd:end,lastNumber:seconds,drops:0}
  next.pendingEnd=(previous.pendingEnd!+end)/2
  next.drops=Math.min(2,previous.drops+Number(seconds<previous.lastNumber!))
  next.lastNumber=seconds
  if(next.drops>=2){
    next.valid=true
    const renewed=previous.expiresAt===null||Math.abs(next.pendingEnd-previous.expiresAt)>4000
    next.cycle=renewed?previous.cycle+1:previous.cycle
    next.expiresAt=renewed?next.pendingEnd:previous.expiresAt
  }
  return next
}
export interface BuffAlertItem { id:string; name:string; expiresAt:number; cycle:number; warnBeforeSec:number }
export function clusterBuffAlerts(items:BuffAlertItem[],now:number,notified:Set<string>,windowMs=3000,history:{expiresAt:number;warnBeforeSec:number}[]=[]):BuffAlertItem[][]{
  const remaining=items.filter(item=>!notified.has(`${item.id}:${item.cycle}`)).sort((a,b)=>a.expiresAt-b.expiresAt)
  const groups:BuffAlertItem[][]=[]
  while(remaining.length){
    const first=remaining.shift()!,group=[first]
    for(let i=0;i<remaining.length;){const item=remaining[i];if(item.warnBeforeSec===first.warnBeforeSec&&item.expiresAt-first.expiresAt<=windowMs){group.push(item);remaining.splice(i,1)}else i++}
    if(first.expiresAt-now<=first.warnBeforeSec*1000){
      const alreadyGrouped=history.some(event=>event.warnBeforeSec===first.warnBeforeSec&&Math.abs(event.expiresAt-first.expiresAt)<=windowMs)
      for(const item of group)notified.add(`${item.id}:${item.cycle}`)
      if(!alreadyGrouped){groups.push(group);history.push({expiresAt:first.expiresAt,warnBeforeSec:first.warnBeforeSec});if(history.length>128)history.shift()}
    }
  }
  return groups
}

/** Identity check for a previously found slot while the large countdown covers
 * its centre. A position alone is never enough to keep a target alive. */
export function verifyBuffEdges(frame:PixelFrame,templates:PixelFrame,match:BuffMatch):boolean{
  const tile=match.target==='potion'?0:1
  const value=edgeScore(frame,templates,tile,match.x,match.y,match.size)
  return value>=.86&&value-edgeScore(frame,templates,tile+2,match.x,match.y,match.size)>=.012
}

export interface DigitModel {digit:string;aspect:number;mask:number[]}
export interface BuffTimeReading {seconds:number;display:string;format:'seconds'|'minutes-seconds';score:number}
/** Read explicit yellow mm:ss separately from unlabelled yellow seconds. White minute labels are excluded. */
export function recognizeBuffTime(frame:PixelFrame,match:Pick<BuffMatch,'x'|'y'|'size'>,models:DigitModel[]):BuffTimeReading|null{
  const {size,x:originX,y:originY}=match,w=Math.round(size),h=w,mask=new Uint8Array(w*h),seen=new Uint8Array(w*h)
  for(let y=Math.floor(h*.29);y<Math.floor(h*.83);y++)for(let x=Math.floor(w*.05);x<Math.floor(w*.95);x++){
    const i=((originY+y)*frame.width+originX+x)*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
    mask[y*w+x]=Number(r>95&&g>95&&Math.abs(r-g)<70&&Math.min(r,g)-b>12)
  }
  const boxes:{x:number;y:number;width:number;height:number}[]=[],dots:{x:number;y:number;width:number;height:number}[]=[]
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue
    const queue=[i];seen[i]=1;let left=w,right=0,top=h,bottom=0
    for(let head=0;head<queue.length;head++){
      const p=queue[head],x=p%w,y=Math.floor(p/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&mask[n]&&!seen[n]){seen[n]=1;queue.push(n)}}
    }
    const width=right-left+1,height=bottom-top+1
    if(height>=h*.17&&height<=h*.6&&width<w*.4&&queue.length>=Math.max(4,8*(w/44)**2)&&top>=h*.27&&bottom+1<=h*.81)boxes.push({x:left,y:top,width,height})
    else if(height>=h*.03&&height<=h*.11&&width>=w*.025&&width<=w*.13&&queue.length>=3)dots.push({x:left,y:top,width,height})
  }
  boxes.sort((a,b)=>a.x-b.x)
  const separators=dots.flatMap((a,i)=>dots.slice(i+1).flatMap(b=>{
    const upper=a.y<b.y?a:b,lower=a.y<b.y?b:a
    const gap=lower.y-upper.y
    return Math.abs((upper.x+upper.width/2)-(lower.x+lower.width/2))<=size*.04&&gap>=size*.07&&gap<=size*.2&&upper.y>=size*.33&&lower.y+lower.height<=size*.7 ? [(upper.x+lower.x+upper.width/2+lower.width/2)/2] : []
  }))
  if(separators.length>1)return null
  // Each font has its own text band. A wider band for the large overlay must
  // not introduce gold icon artwork into the legacy seconds-only reading.
  let best:BuffTimeReading|null=null
  for(const [index,family] of [models,BUFF_OVERLAY_DIGITS].entries()){
    const glyphs=boxes.filter(box=>index===0 ? box.y>=h*.32 : box.y>=h*.27&&box.y+box.height>=h*.59&&box.y+box.height<=h*.74)
    if(!glyphs.length||glyphs.length>4||Math.max(...glyphs.map(b=>b.y))-Math.min(...glyphs.map(b=>b.y))>size*.13)continue
    let text='',quality=1
    for(const box of glyphs){
      const normalized=new Uint8Array(160)
      for(let y=0;y<16;y++)for(let x=0;x<10;x++)normalized[y*10+x]=mask[(box.y+Math.min(box.height-1,Math.floor((y+.5)*box.height/16)))*w+box.x+Math.min(box.width-1,Math.floor((x+.5)*box.width/10))]
      const scores=new Map<string,number>()
      for(const model of family){let error=0;for(let i=0;i<160;i++)error+=Math.abs(normalized[i]-model.mask[i]);const value=1-(error/160*.85+Math.min(1,Math.abs(box.width/box.height-model.aspect))*.15);scores.set(model.digit,Math.max(scores.get(model.digit)??0,value))}
      const ranked=[...scores].sort((a,b)=>b[1]-a[1])
      if(!ranked[0]||ranked[0][1]<.82||ranked[0][1]-(ranked[1]?.[1]??0)<.025){text='';break}
      text+=ranked[0][0];quality=Math.min(quality,ranked[0][1])
    }
    if(!text)continue
    let reading:BuffTimeReading
    if(separators.length){
      const split=glyphs.filter(b=>b.x+b.width<separators[0]).length
      if(split<1||split>2||glyphs.length-split!==2)continue
      const minutes=Number(text.slice(0,split)),seconds=Number(text.slice(split))
      if(seconds>=60)continue
      reading={seconds:minutes*60+seconds,display:`${minutes}:${String(seconds).padStart(2,'0')}`,format:'minutes-seconds',score:quality}
    }else{
      if(glyphs.length>3)continue
      reading={seconds:Number(text),display:`${Number(text)}초`,format:'seconds',score:quality}
    }
    if(!best||reading.score>best.score)best=reading
  }
  return best
}
/** Compatibility entry point: a colon clock must never become an integer such as 920. */
export function recognizeBuffDigits(frame:PixelFrame,match:Pick<BuffMatch,'x'|'y'|'size'>,models:DigitModel[]):{number:number;score:number}|null{
  const time=recognizeBuffTime(frame,match,models)
  return time?.format==='seconds'?{number:time.seconds,score:time.score}:null
}
