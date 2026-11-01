import {test,expect} from '@playwright/test'

test('crowded small potion survives full search and holds uncertain seconds at both analysis scales',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/')
  const results=await page.evaluate(async()=>{
    const {matchBuffs,recognizeBuffTime,verifyBuffEdges}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-potion-seconds.png'),c=document.createElement('canvas'),ctx=c.getContext('2d')!
    c.width=sprite.width;c.height=sprite.height;ctx.drawImage(sprite,0,0);const model=ctx.getImageData(0,0,c.width,c.height),out=[]
    for(const width of[688,960])for(let index=0;index<6;index++){
      c.width=width;c.height=Math.round(388*width/688);ctx.drawImage(strip,0,index*388,688,388,0,0,c.width,c.height)
      const frame=ctx.getImageData(0,0,c.width,c.height),matches=matchBuffs(frame,model),potion=matches.find(m=>m.target==='potion')
      out.push({width,index,potion,verified:!!potion&&verifyBuffEdges(frame,model,potion),time:potion?recognizeBuffTime(frame,potion,BUFF_DIGIT_MODEL):null})
    }
    return out
  })
  for(const row of results){
    expect(row.potion,`${row.width}px sample ${row.index}`).toBeDefined();expect(row.verified).toBe(true)
    expect(Math.abs(row.potion!.x-602*row.width/688)).toBeLessThan(4)
    if(row.time)expect(row.time.seconds).toBe([29,24,18,12,10,9][row.index])
    // The actual warning frame must be readable. Other uncertain glyphs may hold.
    if(row.index===4)expect(row.time?.seconds).toBe(10)
  }
  expect(results.filter(r=>r.time).length).toBeGreaterThanOrEqual(9)
})
