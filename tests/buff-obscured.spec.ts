import {test,expect} from '@playwright/test'
test('resized covered icons identify only the potion and read its actual countdown',async({page})=>{
 test.setTimeout(90000)
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const {matchBuffs,recognizeBuffTime}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
  const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
  const load=async(src:string)=>{const i=new Image();i.src=src;await i.decode();return i}
  const image=await load('/tests/fixtures/buff-obscured-countdown.png'),sprite=await load('/src/assets/buff-targets.png')
  const c=document.createElement('canvas'),ctx=c.getContext('2d')!;c.width=sprite.width;c.height=sprite.height;ctx.drawImage(sprite,0,0);const model=ctx.getImageData(0,0,c.width,c.height)
  const result=[]
  for(let n=0;n<10;n++){
   c.width=960;c.height=472;ctx.drawImage(image,0,502*n,1022,502,0,0,960,472)
   const frame=ctx.getImageData(0,0,960,472),matches=matchBuffs(frame,model)
   result.push(matches.map(m=>({...m,time:recognizeBuffTime(frame,m,BUFF_DIGIT_MODEL)})))
  }
  return result
 })
 for(const row of result){expect(row.map(m=>m.target)).toEqual(['potion']);expect(Math.abs(row[0].x-798)).toBeLessThan(5);expect(row[0].time?.format).toBe('minutes-seconds')}
 expect(result.map(row=>row[0].time?.seconds)).toEqual([170,169,168,167,166,165,164,163,162,161])
})
