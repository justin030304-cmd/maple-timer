import { expect, test } from '@playwright/test'

test('reads decimal seconds and locates the reference box automatically',async({page})=>{
  await page.goto('/')
  const readings=await page.evaluate(async()=>{
    const path='/src/lib/'+'countdown.ts'
    const {findCountdownBox,readCountdown}=await import(path) as typeof import('../src/lib/countdown')
    const readings=[]
    for(let n=1;n<=12;n++){
      const img=new Image();img.src=`/tests/fixtures/countdown/${String(n).padStart(2,'0')}.png`;await img.decode()
      const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080
      const ctx=canvas.getContext('2d')!;ctx.drawImage(img,810,60)
      const frame=ctx.getImageData(0,0,1920,1080),box=findCountdownBox(frame)
      readings.push({box,reading:box?readCountdown(frame,box):null})
    }
    return readings
  })
  expect(readings.map(r=>r.reading?.seconds)).toEqual([14.36,13.38,12.38,11.37,10.38,9.38,8.36,7.4,6.41,5.37,4.38,3.36])
})

test('reference playback drives the real worker and produces one alert at N seconds',async({page})=>{
  await page.addInitScript(()=>{
    const state=window as unknown as {spoken:string[];reference:HTMLVideoElement}
    state.spoken=[]
    class Utterance {text:string;onend:(()=>void)|null=null;onstart:(()=>void)|null=null;constructor(text:string){this.text=text}}
    Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance})
    Object.defineProperty(window,'speechSynthesis',{value:Object.assign(new EventTarget(),{getVoices:()=>[{name:'SunHi',lang:'ko-KR',voiceURI:'sunhi',localService:true}],cancel:()=>{},resume:()=>{},speak:(u:Utterance)=>{state.spoken.push(u.text);u.onstart?.();setTimeout(()=>u.onend?.(),20)}})})
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080
      const ctx=canvas.getContext('2d')!,v=document.createElement('video');state.reference=v
      v.src='/tests/fixtures/countdown/reference.webm';v.muted=true
      await v.play()
      const draw=()=>{ctx.fillStyle='#111';ctx.fillRect(0,0,1920,1080);ctx.drawImage(v,810,60);if(!v.ended)requestAnimationFrame(draw)};draw()
      return canvas.captureStream(15)
    }})
  })
  await page.goto('/')
  const row=page.locator('.monitor-item.kind-countdown')
  await row.getByRole('button',{name:'부스터',exact:true}).click()
  await row.getByLabel('미리 알림 (초)').fill('11')
  await row.getByRole('button',{name:'소리 미리 듣기',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {spoken:string[]}).spoken.length)).toBe(1)
  await page.evaluate(()=>(window as unknown as {spoken:string[]}).spoken=[])
  await page.getByRole('button',{name:'화면 공유 시작',exact:true}).click()
  await expect(row.getByText('소수점 초 감소 확인 · 종료 추적 중',{exact:true}).first()).toBeVisible({timeout:10000})
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {spoken:string[]}).spoken),{timeout:12000}).toEqual(['부스터가 11초 후 종료됩니다.'])
  await expect(row.getByText(/최근 읽은 시간: [3-6]\./)).toBeVisible({timeout:9000})
  expect(await page.evaluate(()=>(window as unknown as {spoken:string[]}).spoken)).toEqual(['부스터가 11초 후 종료됩니다.'])
  await page.getByRole('button',{name:'공유 종료',exact:true}).click()
  await expect(row.getByText('화면 공유를 시작해 주세요',{exact:true})).toBeVisible()
})

test('shifted boxes and blank frames do not rely on the reference coordinates',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const path='/src/lib/'+'countdown.ts'
    const {findCountdownBox,readCountdown}=await import(path) as typeof import('../src/lib/countdown')
    const image=new Image();image.src='/tests/fixtures/countdown/01.png';await image.decode()
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080
    const ctx=canvas.getContext('2d')!,values=[]
    for(const scale of [1,.8,1.25,1.5]){
      ctx.clearRect(0,0,1920,1080);ctx.imageSmoothingEnabled=false;ctx.drawImage(image,777,77,300*scale,110*scale)
      const frame=ctx.getImageData(0,0,1920,1080),box=findCountdownBox(frame)
      values.push({box,seconds:box?readCountdown(frame,box)?.seconds:null})
    }
    ctx.clearRect(0,0,1920,1080)
    const blank=findCountdownBox(ctx.getImageData(0,0,1920,1080))
    ctx.drawImage(image,100,500)
    const frame=ctx.getImageData(0,0,1920,1080)
    const outside=findCountdownBox(frame)
    const manual=findCountdownBox(frame,{x:100/1920,y:500/1080,width:300/1920,height:110/1080})
    return {values,blank,outside,manual:manual?readCountdown(frame,manual)?.seconds:null}
  })
  expect(result.blank).toBe(null)
  expect(result.outside).toBe(null)
  expect(result.manual).toBe(14.36)
  expect(result.values.map(v=>v.seconds)).toEqual([14.36,14.36,14.36,14.36])
})
