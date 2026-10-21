// Stage 5G Chromium UI/IPC integration test ONLY. Transkun inference is mocked
// here; actual V2 checkpoint/CPU inference is checked in a separate workflow.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '/tmp/notiq-stage5g-playwright/node_modules/playwright-core/index.mjs';
const requireWeb=createRequire(new URL('../../web/package.json',import.meta.url));
const {Midi}=requireWeb('@tonejs/midi');
const root=resolve('web/dist');
const server=createServer(async(req,res)=>{
 try{
  const part=new URL(req.url,'http://127.0.0.1').pathname;
  const filename=resolve(join(root,part==='/'?'index.html':decodeURIComponent(part).slice(1)));
  if(!filename.startsWith(root+'/'))throw Error('bad path');
  const b=await readFile(filename);
  const ext=extname(filename);
  res.writeHead(200,{'Content-Type':ext==='.js'?'text/javascript':ext==='.css'?'text/css':'text/html',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
  res.end(b);
 }catch(e){res.writeHead(404);res.end(String(e))}
});
await new Promise(done=>server.listen(4178,'127.0.0.1',done));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1580,height:930},acceptDownloads:true});
const issues=[];page.on('pageerror',err=>issues.push(err.message));
function assert(ok,message){if(!ok)throw Error(message)}
function fixture(){
 const frames=16000*2,buf=Buffer.alloc(44+frames*2);
 buf.write('RIFF',0);buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);
 buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);
 buf.writeUInt32LE(16000,24);buf.writeUInt32LE(32000,28);
 buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);
 buf.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)buf.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/16000)*1100),44+i*2);
 return buf;
}
try{
 await page.addInitScript(()=>{
  window.__engineCalls={muScriptor:0,piano:0};
  window.notiqNative={
   status:async()=>({available:true,modelInstalled:true,modelSize:'small',modelBytes:209425152}),
   pianoStatus:async()=>({available:true,installed:true,description:'Transkun QA mock'}),
   onProgress:()=>()=>{},
   transcribe:async(wav)=>{
    window.__engineCalls.muScriptor++;
    window.__pcmMu=[...new Uint8Array(wav).slice(0,64)];
    return {schema:1,engine:'muscriptor',notes:[
      {pitchMidi:60,startTimeSeconds:0.2,durationSeconds:0.5,amplitude:0.65,program:0,isDrum:false},
      {pitchMidi:67,startTimeSeconds:1.25,durationSeconds:0.4,amplitude:0.7,program:0,isDrum:false}
    ]};
   },
   transcribePiano:async(wav)=>{
    window.__pcmPiano=[...new Uint8Array(wav).slice(0,64)];
    window.__engineCalls.piano++;
    return {schema:1,engine:'transkun-v2',
      notes:[{pitchMidi:60,startTimeSeconds:0.2,durationSeconds:0.5,amplitude:0.65,program:0,isDrum:false},
             {pitchMidi:64,startTimeSeconds:1,durationSeconds:0.4,amplitude:0.8,program:0,isDrum:false}],
      pedalEvents:[{trackKey:'gm-0',timeSeconds:0.1,value:127},
                   {trackKey:'gm-0',timeSeconds:1.5,value:0}]};
   }
  };
 });
 await page.goto('http://127.0.0.1:4178/',{waitUntil:'domcontentloaded'});
 const engine=page.getByRole('combobox',{name:'Engine nhận diện'});
 await engine.waitFor();
 await engine.selectOption('transkun-v2');
 await page.locator('input[type=file]').setInputFiles({name:'piano-2sec.wav',mimeType:'audio/wav',buffer:fixture()});
 await page.getByRole('button',{name:'Nhận diện nốt',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.editable-note').length===2);
 assert(await page.locator('.pedal-marker').count()===2,'V2 CC64 markers missing');
 assert((await page.locator('.editor-status').innerText()).includes('Transkun V2'),'Wrong engine status');
 assert(await page.evaluate(()=>window.__engineCalls.piano===1 && window.__engineCalls.muScriptor===0),'Wrong preliminary engine');
 const received=page.waitForEvent('download',{timeout:10000});
 await page.getByRole('button',{name:'Xuất',exact:true}).click();
 await page.locator('.menu-dropdown button').filter({hasText:'MIDI đa track'}).first().click();
 const download=await received;
 const data=new Uint8Array(await readFile(await download.path()));
 const midi=new Midi(data);
 assert(midi.tracks.filter(t=>t.notes.length).reduce((sum,t)=>sum+t.notes.length,0)===2,
   'V2 pitch/onset MIDI note export count changed');
 assert(midi.tracks.some(t=>(t.controlChanges[64]?.length||0)===2),'Transkun pedal CC64 missing in exported MIDI');
 await engine.selectOption('muscriptor');
 assert(await page.locator('.editable-note').count()===2,'Switching engine deleted existing piano notes');
 await page.getByRole('button',{name:'So sánh hai AI'}).click();
 const panel=page.getByRole('region',{name:'Bảng đối chiếu hai AI'});
 await panel.waitFor({timeout:30000});
 assert((await panel.innerText()).includes('Chỉ MuScriptor'),'Missing difference summary');
 assert((await panel.innerText()).includes('Chỉ Transkun'),'Missing second engine summary');
 assert((await page.locator('.editable-note').count())===2,'Comparison overwrote active MIDI');
 const identical=await page.evaluate(()=>
  JSON.stringify(window.__pcmMu)===JSON.stringify(window.__pcmPiano));
 assert(identical,'Engines received different WAV preprocessing');
 assert(await page.evaluate(()=>window.__engineCalls.piano===2 && window.__engineCalls.muScriptor===1),
  'Both engines were not run sequentially');
 assert((await page.locator('.notiq-5h-note').count())===3,'Comparison overlay should contain 3 unique event positions');
 await panel.getByRole('button',{name:/Dùng MuScriptor/}).click();
 assert(await page.locator('.editable-note').count()===2,'Applying MuScriptor notes failed');
 assert(await page.locator('.editable-note[aria-label^="Nốt G4"]').count()===1,'MuScriptor-only G4 missing');
 await panel.getByRole('button',{name:/Khôi phục MIDI trước/}).click();
 assert(await page.locator('.editable-note[aria-label^="Nốt E4"]').count()===1,'Existing Piano MIDI did not restore');
 assert(await page.locator('.pedal-marker').count()===2,'Transkun pedal lost upon restore');
 await page.getByRole('button',{name:'Mở kiểm tra MIDI chuẩn 5I'}).click();
 const bench=page.getByRole('region',{name:'NOTIQ 5I kiểm tra độ chính xác'});
 await bench.waitFor({timeout:10000});
 await bench.getByRole('combobox',{name:'Chế độ nhạc 5I'}).selectOption('piano');
 const benchmarkMidi=new Midi();
 const track=benchmarkMidi.addTrack();track.instrument.number=0;
 track.addNote({midi:60,time:0.2,duration:0.5,velocity:0.7});
 track.addNote({midi:64,time:1,duration:0.4,velocity:0.8});
 const midiData=Buffer.from(benchmarkMidi.toArray());
 await page.locator('input[type=file][accept*=".mid"]').setInputFiles({
  name:'correct-piano.mid',mimeType:'audio/midi',buffer:midiData
 });
 await page.getByText('correct-piano.mid',{exact:true}).waitFor();
 await bench.getByRole('button',{name:'Chấm điểm hai AI với MIDI chuẩn'}).click();
 const score=bench.getByRole('table');
 await score.waitFor();
 const numbers=await score.innerText();
 if(!numbers.includes('50%')||!numbers.includes('100%'))
  throw Error('Incorrect F1 scoring in reference benchmark: '+numbers);
 if(!(await bench.innerText()).includes('Transkun V2 cao hơn'))
  throw Error('Expected reference-based Transkun recommendation missing');
 await bench.getByRole('button',{name:/Dùng kết quả AI được đề xuất/}).click();
 assert(await page.locator('.editable-note[aria-label^="Nốt E4"]').count()===1,
   '5I user-confirmed engine recommendation did not apply correct MIDI');
 assert(issues.length===0,'Uncaught JS errors: '+JSON.stringify(issues));
 console.log('NOTIQ_STAGE5I_BROWSER_BENCHMARK_PASS',{notes:2,pedalPoints:2,pianoCalls:1,muScriptorCalls:0});
 await page.screenshot({path:'/tmp/notiq-stage5i-reference.png',fullPage:true});
}finally{await browser.close();await new Promise(ok=>server.close(ok))}
