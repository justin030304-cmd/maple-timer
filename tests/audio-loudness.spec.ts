import {test,expect} from '@playwright/test'

test('sustained boosted bell raises rendered average output while zero stays silent',async({page})=>{
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const {scheduleNotificationTones}=await import('/src/lib/'+'notificationTones.ts') as typeof import('../src/lib/notificationTones')
  const measure=async(mode:'previous'|'boosted'|'overlap'|'silent')=>{
   const context=new OfflineAudioContext(1,48000*2,48000)
   if(mode==='previous'){
    // The previous release had a short exponential decay from its attack.
    const output=context.createDynamicsCompressor();output.threshold.value=-3;output.knee.value=3;output.ratio.value=12;output.attack.value=.002;output.release.value=.15;output.connect(context.destination)
    for(const [index,frequency] of [880,659.25].entries())for(const partial of [1,2]){
     const oscillator=context.createOscillator(),gain=context.createGain(),at=index*.34
     oscillator.frequency.value=frequency*partial;gain.gain.setValueAtTime(0,at)
     gain.gain.linearRampToValueAtTime(partial===1?.55:.11,at+.012)
     gain.gain.exponentialRampToValueAtTime(.0001,at+.64)
     oscillator.connect(gain);gain.connect(output);oscillator.start(at);oscillator.stop(at+.65)
    }
   }else{
    scheduleNotificationTones(context,'dingdong',mode==='silent'?0:1,2)
    if(mode==='overlap')scheduleNotificationTones(context,'chime',1,4)
   }
   const rendered=await context.startRendering(),samples=rendered.getChannelData(0)
   return {rms:Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length),peak:samples.reduce((peak,x)=>Math.max(peak,Math.abs(x)),0)}
  }
  return {previous:await measure('previous'),boosted:await measure('boosted'),overlap:await measure('overlap'),silent:await measure('silent')}
 })
 console.log('Rendered alert levels',JSON.stringify(result))
 expect(result.boosted.rms).toBeGreaterThan(result.previous.rms*2)
 expect(result.boosted.peak).toBeLessThanOrEqual(1)
 expect(result.overlap.peak).toBeLessThanOrEqual(1)
 expect(result.silent).toEqual({rms:0,peak:0})
})
