import {test,expect} from '@playwright/test'
test('overlaid minute clocks remain separate from identity and a different emblem is excluded',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {matchBuffs,recognizeBuffDigits,recognizeBuffTime}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
    const load=async(src:string)=>{const i=new Image();i.src=src;await i.decode();return i}
    const template=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-overlaid-minutes.png')
    const c=document.createElement('canvas'),ctx=c.getContext('2d')!
    c.width=template.width;c.height=template.height;ctx.drawImage(template,0,0);const model=ctx.getImageData(0,0,c.width,c.height)
    const result=[]
    for(let n=0;n<3;n++){
      c.width=552;c.height=100;ctx.drawImage(strip,0,n*100,552,100,0,0,552,100)
      const frame=ctx.getImageData(0,0,552,100)
      result.push({matches:matchBuffs(frame,model).map(m=>({...m,time:recognizeBuffTime(frame,m,BUFF_DIGIT_MODEL)})),otherClock:recognizeBuffTime(frame,{x:67,y:22,size:64},BUFF_DIGIT_MODEL),direct:[{x:68,y:21,size:64},{x:324,y:21,size:64}].map(m=>recognizeBuffDigits(frame,m,BUFF_DIGIT_MODEL))})
    }
    return result
  })
  for(const r of result){
    expect(r.matches.map(m=>m.target)).toEqual(['potion'])
    expect(r.direct).toEqual([null,null])
    expect(Math.abs(r.matches[0].x-324)).toBeLessThan(9)
    expect(r.matches.every(m=>m.time?.format==='minutes-seconds')).toBe(true)
  }
  expect(result.map(r=>r.matches.map(m=>m.time?.seconds))).toEqual([[560],[556],[552]])
  expect(result.map(r=>r.otherClock?.seconds)).toEqual([543,539,535])
})
