import {test,expect} from '@playwright/test'
test('recorded minimap detects the violet rune after it appears',async({page})=>{
 await page.goto('/')
 const readings=await page.evaluate(async()=>{
  const {detectRune,DEFAULT_RUNE_OPTIONS}=await import('/src/lib/'+'rune.ts') as typeof import('../src/lib/rune')
  const image=new Image();image.src='/tests/fixtures/rune-recorded-minimap.png';await image.decode()
  const c=document.createElement('canvas');c.width=366;c.height=248;const ctx=c.getContext('2d')!,readings=[]
  for(let n=0;n<8;n++){ctx.drawImage(image,0,n*248,366,248,0,0,366,248);readings.push(detectRune(ctx.getImageData(0,0,366,248),DEFAULT_RUNE_OPTIONS))}
  return readings
 })
 expect(readings.slice(0,2).every(r=>r.candidate===null)).toBe(true)
 expect(readings.slice(2).every(r=>r.candidate!==null)).toBe(true)
 for(const r of readings.slice(2)){expect(Math.abs(r.candidate!.x-154)).toBeLessThan(6);expect(Math.abs(r.candidate!.y-160)).toBeLessThan(6)}
})

test('recorded rune survives translated and resized minimap input',async({page})=>{
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const {detectRune,DEFAULT_RUNE_OPTIONS}=await import('/src/lib/'+'rune.ts') as typeof import('../src/lib/rune')
  const image=new Image();image.src='/tests/fixtures/rune-recorded-minimap.png';await image.decode()
  const c=document.createElement('canvas');c.width=600;c.height=400;const ctx=c.getContext('2d')!,result=[]
  for(const scale of [.5,.75,1,1.25]){
    ctx.clearRect(0,0,600,400);ctx.drawImage(image,0,248*2,366,248,21,17,366*scale,248*scale)
    result.push({scale,candidate:detectRune(ctx.getImageData(0,0,600,400),DEFAULT_RUNE_OPTIONS).candidate})
  }
  return result
 })
 for(const r of result){expect(r.candidate).not.toBeNull();expect(Math.abs(r.candidate!.x-(21+154*r.scale))).toBeLessThan(4);expect(Math.abs(r.candidate!.y-(17+160*r.scale))).toBeLessThan(4)}
})
