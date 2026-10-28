import {test,expect} from '@playwright/test'

test('recorded EXP totals change while percentages stay fixed and compression stays quiet',async({page})=>{
  await page.goto('/')
  const results=await page.evaluate(async()=>{
    const {experienceGlyphs,experienceGlyphsChanged,glyphDifference}=await import('/src/lib/'+'experienceVisual.ts') as typeof import('../src/lib/experienceVisual')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const image=await load('/tests/fixtures/experience-missed-updates.png'),single=await load('/tests/fixtures/experience-single-digit.png')
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;canvas.width=370;canvas.height=26
    const read=(image:HTMLImageElement,n:number)=>{ctx.drawImage(image,0,n*26,370,26,0,0,370,26);return experienceGlyphs(ctx.getImageData(0,0,370,26))}
    const frames=Array.from({length:27},(_,n)=>read(image,n)),before=read(single,0),after=read(single,1)
    return {changes:frames.slice(1).map((frame,n)=>experienceGlyphsChanged(frames[n],frame)),single:{global:glyphDifference(before,after),changed:experienceGlyphsChanged(before,after)}}
  })
  // Manually checked values in the recording change at these sample indexes.
  for(const n of [4,8,10,19,21,23,24])expect(results.changes[n-1],`changed total at ${n/2}s`).toBe(true)
  for(const n of [3,5,6,7,9,11,12,13,14,15,16,17,18,20,22,25,26])expect(results.changes[n-1],`same total at ${n/2}s`).toBe(false)
  // Controlled stress fixture: replace only the last digit using recorded glyphs.
  expect(results.single.global).toBeLessThan(.08)
  expect(results.single.changed).toBe(true)
})
