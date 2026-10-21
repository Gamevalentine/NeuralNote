// NOTIQ Stage 5A: end-to-end real, independently recorded CC BY 4.0 song.
// No synthetic/repeated audio and no mock notes. Uses deployed HTTPS preview,
// original MuScriptor GGUF and original pthread4 WASM, UI and exported MIDI.
import {chromium} from '/tmp/notiq-5a-playwright/node_modules/playwright-core/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const url='https://test-notiq-stage5a-long-real.neuralnote-e4c.pages.dev/';
const durations=process.env.NOTIQ_5A_CASE==='180' ? [180] : [60,180];
function readMidi(data) {
  const b=new Uint8Array(data);
  const as=(p,n)=>String.fromCharCode(...b.subarray(p,p+n));
  const u16=p=>(b[p]<<8)|b[p+1];
  const u32=p=>(b[p]*16777216+b[p+1]*65536+b[p+2]*256+b[p+3])>>>0;
  if(as(0,4)!=='MThd'||u32(4)!==6||u16(8)!==1)throw Error('Expected MIDI type 1, MThd');
  const tracks=u16(10),ppq=u16(12);
  let i=14,on=0,off=0,largestTick=0,programs=new Set();
  for(let t=0;t<tracks;t++){
    if(as(i,4)!=='MTrk')throw Error('Missing MTrk '+t);
    const end=i+8+u32(i+4);i+=8;let tick=0,running=0,endMarker=false;
    while(i<end){
      let q,delta=0;do{if(i>=end)throw Error('Bad MIDI delta VLQ');q=b[i++];delta=(delta<<7)|(q&127)}while(q&128);tick+=delta;
      largestTick=Math.max(tick,largestTick);
      let status=b[i++];
      if(status<128){if(!running)throw Error('Missing running status');i--;status=running}
      else if(status<240)running=status;
      if(status===255){const kind=b[i++];let size=0;do{q=b[i++];size=(size<<7)|(q&127)}while(q&128);i+=size;if(kind===47)endMarker=true;continue}
      if(status===240||status===247){let size=0;do{q=b[i++];size=(size<<7)|(q&127)}while(q&128);i+=size;continue}
      const kind=status&240,a=b[i++],v=(kind===192||kind===208)?0:b[i++];
      if(kind===144&&v>0)on++;
      if(kind===128||(kind===144&&v===0))off++;
      if(kind===192)programs.add(a);
    }
    if(i!==end||!endMarker)throw Error('MIDI track is corrupt: '+t);
  }
  if(i!==b.length||on!==off||on<=0)throw Error('Invalid MIDI note-on/off counts');
  return {bytes:b.length,tracks,ppq,noteOn:on,noteOff:off,lastSecond:Number((largestTick/960).toFixed(2)),programs:[...programs].sort((a,b)=>a-b)};
}
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=8192']});
const results=[];
try {
  const page=await browser.newPage({acceptDownloads:true});
  const errors=[],failures=[],timings=[],repairs=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('NOTIQ_5A_PAGE_ERROR',e.message)});
  page.on('crash',()=>{errors.push('Renderer crashed');console.log('NOTIQ_5A_CRASH')});
  page.on('console',m=>{
    const s=m.text();
    if(s.includes('NOTIQ_CORE_TIMING')){timings.push(s);console.log('NOTIQ_5A_TIMING',s)}
    if(s.includes('NOTIQ_PCM_REPAIR')){repairs.push(s);console.log('NOTIQ_5A_REPAIR',s)}
    if(m.type()==='error')console.log('NOTIQ_5A_CONSOLE_ERROR',s.slice(0,250));
  });
  page.on('requestfailed',req=>{
    const s=req.url().slice(0,200)+' '+req.failure()?.errorText;
    failures.push(s);console.log('NOTIQ_5A_REQUEST_FAILED',s);
  });
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:65000});
  if(!r?.ok())throw Error('Preview HTTPS failed '+r?.status());
  const isolated=await page.evaluate(()=>({crossOriginIsolated:self.crossOriginIsolated,
    shared:typeof SharedArrayBuffer==='function',threads:navigator.hardwareConcurrency,
    deviceMemory:navigator.deviceMemory??null}));
  console.log('NOTIQ_5A_HARDWARE',JSON.stringify(isolated));
  if(!isolated.crossOriginIsolated||!isolated.shared)throw Error('No pthread isolation on preview');
  for(const seconds of durations) {
    const filename='/tmp/notiq-5a-'+seconds+'s.wav';
    const wallStart=Date.now();
    console.log('NOTIQ_5A_START',seconds,filename);
    await page.locator('input[type=file]').setInputFiles(filename);
    if(seconds===durations[0]) {
      await page.getByRole('button',{name:'Tải mô hình AI'}).click();
    }
    // Never accidentally accept the previous song's completion UI.
    await page.locator('.ai-running-indicator').waitFor({state:'visible',timeout:120000});
    console.log('NOTIQ_5A_INFERENCE_STARTED',seconds);
    await page.locator('.ai-running-indicator').waitFor({
      state:'hidden',timeout:seconds===60?13*60*1000:23*60*1000
    });
    console.log('NOTIQ_5A_INFERENCE_FINISHED',seconds);
    const txt=await page.locator('body').innerText();
    const match=txt.match(/MuScriptor AI Core: (\d+) nốt/);
    if(!match) {
      const alerts=await page.locator('.error-banner').allTextContents();
      const status=await page.locator('.editor-status').allTextContents();
      console.log('NOTIQ_5A_FAILURE_DETAILS',JSON.stringify({
        seconds,alerts,status,consoleErrors:errors,failedRequests:failures,
        bodySnippet:txt.slice(0,700),bodyTail:txt.slice(-700)}));
      throw Error('No real inference result at '+seconds+'s; see full error-banner diagnostic above');
    }
    const noteCount=Number(match[1]);
    if(noteCount<seconds*2)throw Error('Suspect incomplete transcription: '+noteCount);
    const incoming=page.waitForEvent('download',{timeout:25000});
    await page.getByRole('button',{name:'Xuất',exact:true}).first().click();
    await page.getByRole('button',{name:/MIDI đa track/}).click();
    const saved=await incoming;
    const midi=readMidi(readFileSync(await saved.path()));
    if(midi.noteOn!==noteCount)throw Error('Missing or duplicated note events in exported MIDI: '+midi.noteOn+' != '+noteCount);
    // MIDI event at least 60% into original recording, otherwise pipeline
    // might have silently analyzed only the first ~15 seconds.
    if(midi.lastSecond<seconds*0.60||midi.lastSecond>seconds+4)
      throw Error('MIDI timeline coverage invalid: '+midi.lastSecond+' sec for '+seconds);
    const result={durationSec:seconds,notes:noteCount,midi,elapsedMs:Date.now()-wallStart,
      browserErrors:errors.length,pcmCorrections:repairs,source:'The Entertainer - Kevin MacLeod, original recording, CC BY 4.0',
      audio:'first '+seconds+' seconds of independent 193.38-second recording, NOT repeated'};
    console.log('NOTIQ_5A_REAL_MUSIC_PASS',JSON.stringify(result));
    results.push(result);
    if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
    // Explicitly wait for the AI-loaded UI to settle before starting next song.
    await page.waitForTimeout(500);
  }
  writeFileSync('/tmp/notiq-stage5a-result.json',JSON.stringify({passed:true,
    test:'Long-form source audio through original MuScriptor pthread4 on HTTPS Preview',
    rights:'Kevin MacLeod - The Entertainer, CC BY 4.0, Wikimedia Commons',
    results,timingMessages:timings,failedRequests:failures},null,2)+'\n');
  console.log('NOTIQ_STAGE5A_'+durations.join('_')+'_SECONDS_PASS');
}finally{
  await browser.close();
}
