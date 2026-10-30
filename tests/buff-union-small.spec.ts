import {test,expect} from '@playwright/test'

test('small recorded Union icons remain classified and cached checks reject a replaced icon',async({page})=>{
  test.setTimeout(60000)
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {matchBuffs,verifyBuffEdges,recognizeBuffTime,hasWhiteMinuteLabel}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-union-small.png')
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;canvas.width=sprite.width;canvas.height=sprite.height;ctx.drawImage(sprite,0,0);const templates=ctx.getImageData(0,0,canvas.width,canvas.height)
    const frames=[];let first:ReturnType<typeof matchBuffs>[number]|undefined
    for(let n=0;n<19;n++){
      canvas.width=688;canvas.height=200;ctx.drawImage(strip,0,n*200,688,200,0,0,688,200)
      const frame=ctx.getImageData(0,0,688,200),union=matchBuffs(frame,templates).find(m=>m.target==='union-wealth')
      first??=union
      frames.push({union,verified:!!first&&verifyBuffEdges(frame,templates,first),minute:!!union&&hasWhiteMinuteLabel(frame,union),time:union?recognizeBuffTime(frame,union,BUFF_DIGIT_MODEL):null})
    }
    // Replace the last known slot with the previously rejected golden lookalike.
    ctx.drawImage(sprite,5*32,0,32,32,first!.x,first!.y,first!.size,first!.size)
    const replacement=verifyBuffEdges(ctx.getImageData(0,0,688,200),templates,first!)
    return {frames,replacement}
  })
  for(const [n,frame]of result.frames.entries()){
    expect(frame.union,`Union sample ${n}`).toBeDefined()
    expect(frame.union?.x).toBe(538);expect(frame.union?.y).toBe(111)
    expect(frame.verified).toBe(true);expect(frame.minute).toBe(true);expect(frame.time).toBeNull()
  }
  expect(result.replacement).toBe(false)
})
