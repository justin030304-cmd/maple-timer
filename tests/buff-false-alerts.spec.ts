import {test,expect} from '@playwright/test'
test('absent union and white minute counters cannot become imminent expiry alerts',async({page})=>{
 test.setTimeout(90000)
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const {matchBuffs,recognizeBuffTime,verifyBuffEdges,hasWhiteMinuteLabel,advanceBuffClock,emptyBuffClock,clusterBuffAlerts}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
  const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
  const load=async(src:string)=>{const i=new Image();i.src=src;await i.decode();return i}
  const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-union-absent.png')
  const c=document.createElement('canvas'),ctx=c.getContext('2d')!;c.width=sprite.width;c.height=sprite.height;ctx.drawImage(sprite,0,0);const templates=ctx.getImageData(0,0,c.width,c.height)
  const results=[],notified=new Set<string>();let clock=emptyBuffClock()
  for(let n=0;n<9;n++){
   c.width=922;c.height=420;ctx.drawImage(strip,0,n*420,922,420,0,0,922,420);const frame=ctx.getImageData(0,0,922,420)
   const matches=matchBuffs(frame,templates),potion=matches.find(m=>m.target==='potion'),time=potion?recognizeBuffTime(frame,potion,BUFF_DIGIT_MODEL):null
   clock=advanceBuffClock(clock,time?.seconds??null,n*800)
   const alerts=clusterBuffAlerts(clock.valid?[{id:'potion',name:'비약',expiresAt:clock.expiresAt!,cycle:clock.cycle,warnBeforeSec:10}]:[],n*800,notified)
   results.push({matches,time,minute:potion?hasWhiteMinuteLabel(frame,potion):false,alerts,warm:[{target:'union-wealth' as const,x:564,y:138,size:56,score:1},{target:'union-wealth' as const,x:819,y:60,size:64,score:1}].map(m=>verifyBuffEdges(frame,templates,m))})
  }
  return results
 })
 for(const r of result){expect(r.matches.some(m=>m.target==='union-wealth')).toBe(false);expect(r.time).toBeNull();expect(r.alerts).toEqual([]);expect(r.warm).toEqual([false,false])}
 expect(result.filter(r=>r.matches.some(m=>m.target==='potion')).length).toBeGreaterThanOrEqual(6)
 expect(result.filter(r=>r.minute).length).toBeGreaterThanOrEqual(6)
})
