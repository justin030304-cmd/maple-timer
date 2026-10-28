import { BUFF_OVERLAY_DIGITS } from './buffOverlayDigitModel'
import type { PixelFrame } from './analysis'
export type BuffTarget = 'potion' | 'union-wealth'
export const BUFF_NAMES: Record<BuffTarget,string> = {potion:'비약','union-wealth':'유니온의 부'}
export interface BuffMatch { target: BuffTarget; x:number; y:number; size:number; score:number }
const positiveTiles=(tile:number)=>tile===0?[0,6]:[1]
const negativeTiles=(tile:number)=>tile===0?[2]:[3,4,5]
const luma=(data:Uint8ClampedArray,index:number)=>(data[index]+data[index+1]*2+data[index+2])/4
function neutralFrame(frame:PixelFrame,x:number,y:number,size:number,coarse=false):boolean{
  let count=0
  for(const [px,py] of [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]){
    const i=((y+Math.floor(py*size))*frame.width+x+Math.floor(px*size))*4
    const low=Math.min(frame.data[i],frame.data[i+1],frame.data[i+2]),high=Math.max(frame.data[i],frame.data[i+1],frame.data[i+2])
    if(low>=65&&high-low<85)count++
  }
  return count>=(coarse?1:2)
}
function paletteMatches(frame:PixelFrame,tile:number,x:number,y:number,size:number,coarse=false):boolean{
  let count=0
  if(tile===0){
    for(const py of [.08,.13,.18,.23,.28])for(const px of [.1,.15,.2,.25,.3]){
      const i=((y+Math.floor(py*size))*frame.width+x+Math.floor(px*size))*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
      if(g>r+6&&b>r+10&&g>b*.6&&b>g*.65&&Math.max(r,g,b)>40)count++
    }
    if(count<(coarse?2:4))return false
    count=0
    for(const py of [.73,.77,.81,.85,.89])for(const px of [.48,.56,.64,.72,.8,.88]){
      const i=((y+Math.floor(py*size))*frame.width+x+Math.floor(px*size))*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
      if(Math.min(r,g)>b+8&&Math.max(r,g)>55)count++
    }
    return count>=(coarse?1:2)
  }
  for(const py of [.1,.17,.24])for(const px of [.2,.35,.5,.65,.8]){
    const i=((y+Math.floor(py*size))*frame.width+x+Math.floor(px*size))*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
    if(Math.min(r,g)>b+10&&Math.max(r,g)>80)count++
  }
  return count>=(coarse?1:3)
}
function patchCorrelation(frame:PixelFrame,templates:PixelFrame,tile:number,x:number,y:number,size:number,bottom:boolean,stride=1):number{
  let a=0,b=0,aa=0,bb=0,ab=0,n=0
  for(let py=bottom?23:2;py<(bottom?30:10);py+=stride)for(let px=bottom?14:3;px<(bottom?28:29);px+=stride){
    const i=((y+Math.floor((py+.5)*size/32))*frame.width+x+Math.floor((px+.5)*size/32))*4,j=(py*templates.width+tile*32+px)*4
    const va=luma(frame.data,i),vb=luma(templates.data,j)
    a+=va;b+=vb;aa+=va*va;bb+=vb*vb;ab+=va*vb;n++
  }
  return (ab-a*b/n)/Math.sqrt(Math.max(.001,(aa-a*a/n)*(bb-b*b/n)))
}
function structuralClass(frame:PixelFrame,templates:PixelFrame,tiles:number[],x:number,y:number,size:number,stride=1){
  let best={top:-1,bottom:-1,score:-1}
  for(const tile of tiles)if((tile+1)*32<=templates.width){
    const top=patchCorrelation(frame,templates,tile,x,y,size,false,stride),bottom=patchCorrelation(frame,templates,tile,x,y,size,true,stride),score=top*.6+bottom*.4
    if(score>best.score)best={top,bottom,score}
  }
  return best
}
// Broad color agreement proposes locations only; final identity uses the
// unobscured structural patches and rejects similar icons independently.
function appearanceProposal(frame:PixelFrame,templates:PixelFrame,tiles:number[],x:number,y:number,size:number):number{
  let best=0
  for(const tile of tiles){
    let error=0,n=0
    for(const py of [4,10,20,27])for(const px of [4,10,16,22,27]){
      const i=((y+Math.floor((py+.5)*size/32))*frame.width+x+Math.floor((px+.5)*size/32))*4,j=(py*templates.width+tile*32+px)*4
      for(let c=0;c<3;c++){error+=Math.abs(frame.data[i+c]-templates.data[j+c]);n++}
    }
    best=Math.max(best,1-error/(n*255))
  }
  return best
}
/** Timer pixels never contribute to identity: compare cap/emblem and lower
 * bottle contents or Roman numeral, with brightness-normalized local contrast. */
function identityScore(frame:PixelFrame,templates:PixelFrame,tile:number,x:number,y:number,size:number):number{
  if(!neutralFrame(frame,x,y,size)||!paletteMatches(frame,tile,x,y,size))return 0
  const match=structuralClass(frame,templates,positiveTiles(tile),x,y,size)
  if(match.top<.5||match.bottom<(tile===0?.4:.55)||match.score<(tile===0?.6:.65))return 0
  const other=structuralClass(frame,templates,negativeTiles(tile),x,y,size)
  if(match.score-other.score<(tile===0?.008:.05))return 0
  return match.score
}
/** Search scale includes 60px icons produced by the 960px analysis resize. */
export function matchBuffs(frame:PixelFrame,templates:PixelFrame):BuffMatch[]{
  const result:BuffMatch[]=[]
  for(let tile=0;tile<2;tile++){
    const positives=positiveTiles(tile)
    let best:BuffMatch|null=null
    for(const size of [20,24,28,30,32,34,36,40,44,48,52,56,60,64]){
      if(size>frame.width||size>frame.height)continue
      const step=Math.max(2,Math.round(size/(size>=48?16:8))),proposals:{x:number;y:number;score:number}[]=[],colorProposals:{x:number;y:number;score:number}[]=[]
      for(let y=0;y<=frame.height-size;y+=step)for(let x=0;x<=frame.width-size;x+=step){
        if(!neutralFrame(frame,x,y,size,true)||!paletteMatches(frame,tile,x,y,size,true))continue
        const ranks=[(structuralClass(frame,templates,positives,x,y,size,3).score+1)/2,appearanceProposal(frame,templates,positives,x,y,size)]
        for(const [index,list] of [proposals,colorProposals].entries()){
          const value=ranks[index]
          if(value>=.45&&(list.length<20||value>list[list.length-1].score)){list.push({x,y,score:value});list.sort((a,b)=>b.score-a.score);if(list.length>20)list.pop()}
        }
      }
      const checked=new Set<number>()
      for(const candidate of [...proposals,...colorProposals])for(let dy=-step;dy<=step;dy++)for(let dx=-step;dx<=step;dx++){
        const x=candidate.x+dx,y=candidate.y+dy
        if(x<0||y<0||x+size>frame.width||y+size>frame.height)continue
        const key=y*frame.width+x
        if(checked.has(key))continue
        checked.add(key)
        const value=identityScore(frame,templates,tile,x,y,size)
        if(value>0&&(!best||value>best.score))best={target:tile===0?'potion':'union-wealth',x,y,size,score:value}
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
  return identityScore(frame,templates,tile,match.x,match.y,match.size)>0
}

/** White lower-left minute labels rule out an ending-soon yellow seconds clock. */
export function hasWhiteMinuteLabel(frame:PixelFrame,match:Pick<BuffMatch,'x'|'y'|'size'>):boolean{
  const {x:ox,y:oy,size}=match,reach=Math.max(1,Math.round(size/32))
  let contrast=0
  for(let y=Math.floor(size*.64);y<Math.floor(size*.98);y++)for(let x=Math.floor(size*.02);x<Math.floor(size*.34);x++){
    const px=ox+x,py=oy+y
    if(px<0||py<0||px>=frame.width||py>=frame.height)continue
    const i=(py*frame.width+px)*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
    if(Math.min(r,g,b)<190||Math.max(r,g,b)-Math.min(r,g,b)>60)continue
    let dark=false
    for(let dy=-reach;dy<=reach&&!dark;dy++)for(let dx=-reach;dx<=reach;dx++){
      const xx=px+dx,yy=py+dy
      if(xx<0||yy<0||xx>=frame.width||yy>=frame.height)continue
      const n=(yy*frame.width+xx)*4
      if(Math.max(frame.data[n],frame.data[n+1],frame.data[n+2])<85){dark=true;break}
    }
    if(dark)contrast++
  }
  return contrast>=Math.max(4,size*size*.003)
}
export interface BuffIdentity {candidate:BuffMatch|null;frames:number}
export function advanceBuffIdentity(previous:BuffIdentity,found:BuffMatch|null):BuffIdentity{
  if(!found)return {candidate:null,frames:0}
  const old=previous.candidate
  const same=old&&old.target===found.target&&Math.min(old.size,found.size)/Math.max(old.size,found.size)>=.72
  return {candidate:found,frames:same?Math.min(2,previous.frames+1):1}
}

export interface DigitModel {digit:string;aspect:number;mask:number[]}
export interface BuffTimeReading {seconds:number;display:string;format:'seconds'|'minutes-seconds';score:number}
/** Read explicit yellow mm:ss separately from unlabelled yellow seconds. White minute labels are excluded. */
function readBuffTimeAtBox(frame:PixelFrame,match:Pick<BuffMatch,'x'|'y'|'size'>,models:DigitModel[],yellowThreshold=95):BuffTimeReading|null{
  const {size,x:originX,y:originY}=match,w=Math.round(size),h=w,mask=new Uint8Array(w*h),seen=new Uint8Array(w*h)
  for(let y=Math.floor(h*.29);y<Math.floor(h*.83);y++)for(let x=Math.floor(w*.05);x<Math.floor(w*.95);x++){
    const i=((originY+y)*frame.width+originX+x)*4,r=frame.data[i],g=frame.data[i+1],b=frame.data[i+2]
    mask[y*w+x]=Number(r>yellowThreshold&&g>yellowThreshold&&Math.abs(r-g)<70&&Math.min(r,g)-b>12)
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
  const whiteMinutes=hasWhiteMinuteLabel(frame,match)
  if(whiteMinutes&&!separators.length)return null
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
      if(glyphs.length>2||Number(text)>60)continue
      reading={seconds:Number(text),display:`${Number(text)}초`,format:'seconds',score:quality}
    }
    if(whiteMinutes&&reading.seconds<=59)continue
    if(!best||reading.score>best.score)best=reading
  }
  return best
}
/** Border alignment can differ by a pixel after capture resizing. Retry only
 * an unreadable clock and require agreeing shifted reads before accepting it. */
export function recognizeBuffTime(frame:PixelFrame,match:Pick<BuffMatch,'x'|'y'|'size'>,models:DigitModel[]):BuffTimeReading|null{
  const direct=readBuffTimeAtBox(frame,match,models)
  if(direct)return direct
  if(hasWhiteMinuteLabel(frame,match))return null
  const votes=new Map<string,{reading:BuffTimeReading;count:number}>()
  for(const threshold of [95,125,155])for(const dy of [0,-1,1,-2,2]){
    if(threshold===95&&dy===0)continue
    const shifted={...match,y:match.y+dy}
    if(shifted.y<0||shifted.y+shifted.size>frame.height)continue
    const reading=readBuffTimeAtBox(frame,shifted,models,threshold)
    if(!reading)continue
    const key=`${reading.format}:${reading.seconds}`,old=votes.get(key)
    votes.set(key,{reading:old&&old.reading.score>reading.score?old.reading:reading,count:(old?.count??0)+1})
  }
  const agreed=[...votes.values()].filter(v=>v.count>=2).sort((a,b)=>b.count-a.count||b.reading.score-a.reading.score)
  return agreed.length===1||agreed.length>1&&agreed[0].count>agreed[1].count?agreed[0].reading:null
}
/** Compatibility entry point: a colon clock must never become an integer such as 920. */
export function recognizeBuffDigits(frame:PixelFrame,match:Pick<BuffMatch,'x'|'y'|'size'>,models:DigitModel[]):{number:number;score:number}|null{
  const time=recognizeBuffTime(frame,match,models)
  return time?.format==='seconds'?{number:time.seconds,score:time.score}:null
}
