import {test,expect} from '@playwright/test'

test('recorded small Union mm:ss overlays keep identity and cannot become partial seconds',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/')
  const results=await page.evaluate(async()=>{
    const {matchBuffs,verifyBuffEdges,recognizeBuffTime,recognizeBuffDigits,advanceBuffClock,emptyBuffClock}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-union-minute-overlay.png')
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;canvas.width=sprite.width;canvas.height=sprite.height;ctx.drawImage(sprite,0,0);const templates=ctx.getImageData(0,0,canvas.width,canvas.height)
    const output=[];let first:ReturnType<typeof matchBuffs>[number]|undefined,clock=emptyBuffClock()
    for(let n=0;n<23;n++){
      canvas.width=688;canvas.height=200;ctx.drawImage(strip,0,n*200,688,200,0,0,688,200)
      const frame=ctx.getImageData(0,0,688,200),union=matchBuffs(frame,templates).find(m=>m.target==='union-wealth')
      first??=union
      const time=union?recognizeBuffTime(frame,union,BUFF_DIGIT_MODEL):null
      clock=advanceBuffClock(clock,time?.seconds??null,n*500)
      output.push({union,time,secondsOnly:union?recognizeBuffDigits(frame,union,BUFF_DIGIT_MODEL):null,valid:clock.valid,verified:!!first&&verifyBuffEdges(frame,templates,first)})
    }
    return output
  })
  for(const [n,r]of results.entries()){
    expect(r.union,`identity ${n}`).toBeDefined();expect(r.union?.x).toBe(506);expect(r.union?.y).toBe(143)
    expect(r.verified).toBe(true);expect(r.time?.format).toBe('minutes-seconds');expect(r.secondsOnly).toBeNull();expect(r.valid).toBe(false)
  }
  expect(results.map(r=>r.time?.seconds)).toEqual([557,557,557,556,556,555,554,554,554,553,552,552,552,551,551,550,550,549,548,548,547,547,547])
})
