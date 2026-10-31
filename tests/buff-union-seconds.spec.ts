import {test,expect} from '@playwright/test'

test('crowded worker frames retain the real Union location in full search',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {matchBuffs,verifyBuffEdges}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-union-search-candidates.png')
    const c=document.createElement('canvas'),ctx=c.getContext('2d')!;c.width=sprite.width;c.height=sprite.height;ctx.drawImage(sprite,0,0);const templates=ctx.getImageData(0,0,c.width,c.height),legacy=ctx.getImageData(0,0,256,32),out=[]
    for(let n=0;n<3;n++){c.width=688;c.height=388;ctx.drawImage(strip,0,n*388,688,388,0,0,688,388);const frame=ctx.getImageData(0,0,688,388);out.push({found:matchBuffs(frame,templates).find(m=>m.target==='union-wealth'),legacy:n===0?matchBuffs(frame,legacy).find(m=>m.target==='union-wealth'):null,verified:verifyBuffEdges(frame,templates,{target:'union-wealth',x:506,y:143,size:32,score:1})})}
    return out
  })
  expect(result[0].legacy).toMatchObject({x:506,y:143,size:32})
  for(const row of result){expect(row.verified).toBe(true);expect(row.found).toMatchObject({x:506,y:143,size:32})}
})

test('recorded sub-minute Union digits stay complete and drive one configured warning',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {matchBuffs,recognizeBuffTime,verifyBuffEdges,advanceBuffClock,emptyBuffClock,clusterBuffAlerts}=await import('/src/lib/'+'buffs.ts') as typeof import('../src/lib/buffs')
    const {BUFF_DIGIT_MODEL}=await import('/src/lib/'+'buffDigitModel.ts') as typeof import('../src/lib/buffDigitModel')
    const load=async(src:string)=>{const image=new Image();image.src=src;await image.decode();return image}
    const sprite=await load('/src/assets/buff-targets.png'),strip=await load('/tests/fixtures/buff-union-seconds.png'),c=document.createElement('canvas'),ctx=c.getContext('2d')!
    c.width=sprite.width;c.height=sprite.height;ctx.drawImage(sprite,0,0);const templates=ctx.getImageData(0,0,c.width,c.height),out=[],notified40=new Set<string>(),notified10=new Set<string>(),alerts40:unknown[]=[],alerts10:unknown[]=[]
    let clock=emptyBuffClock(),position:ReturnType<typeof matchBuffs>[number]|undefined
    for(let n=0;n<23;n++){
      c.width=688;c.height=200;ctx.drawImage(strip,0,n*200,688,200,0,0,688,200);const frame=ctx.getImageData(0,0,688,200)
      position=position&&verifyBuffEdges(frame,templates,position)?position:matchBuffs(frame,templates).find(m=>m.target==='union-wealth')
      const time=position?recognizeBuffTime(frame,position,BUFF_DIGIT_MODEL):null;clock=advanceBuffClock(clock,time?.seconds??null,n*500)
      out.push({identified:!!position,time,potionTime:recognizeBuffTime(frame,{x:602,y:144,size:32},BUFF_DIGIT_MODEL),valid:clock.valid})
      for(const [warnBeforeSec,notified,alerts]of [[40,notified40,alerts40],[10,notified10,alerts10]] as const){alerts.push(...clusterBuffAlerts(clock.valid?[{id:'union',name:'유니온의 부',expiresAt:clock.expiresAt!,cycle:clock.cycle,warnBeforeSec}]:[],n*500,notified))}
    }
    return {out,alerts40,alerts10}
  })
  const expected=[47,46,46,46,45,45,44,44,43,43,42,42,41,41,40,40,39,39,38,38,37,37,36]
  for(const [n,row]of result.out.entries()){
    expect(row.identified,`identity ${n}`).toBe(true)
    expect(row.potionTime,`white potion minutes ${n}`).toBeNull()
    if(row.time){expect(row.time.format).toBe('seconds');expect(row.time.seconds,`seconds ${n}`).toBe(expected[n])}
  }
  expect(result.out.filter(row=>row.time).length).toBeGreaterThanOrEqual(21)
  expect(result.out.some(row=>row.valid)).toBe(true)
  expect(result.alerts40).toHaveLength(1);expect(result.alerts10).toHaveLength(0)
})
