import {test,expect} from '@playwright/test'

test('Union references and timer fonts apply at native and resized capture scales',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {matchBuffs,recognizeBuffTime}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-union-alert-scales.png'),c=document.createElement('canvas'),ctx=c.getContext('2d')!
    c.width=sprite.width;c.height=sprite.height;ctx.drawImage(sprite,0,0);const templates=ctx.getImageData(0,0,c.width,c.height),out=[]
    for(const width of[688,960])for(let n=0;n<4;n++){
      c.width=width;c.height=Math.round(388*width/688);ctx.drawImage(strip,0,n*388,688,388,0,0,c.width,c.height)
      const frame=ctx.getImageData(0,0,c.width,c.height),union=matchBuffs(frame,templates).find(m=>m.target==='union-wealth')
      out.push({width,index:n,union,time:union?recognizeBuffTime(frame,union,BUFF_DIGIT_MODEL):null})
    }
    return out
  })
  for(const row of result){expect(row.union,`${row.width}px sample ${row.index}`).toBeDefined();expect(row.time?.seconds).toBe([27,13,10,9][row.index])}
})
