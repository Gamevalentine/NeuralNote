// Stage 5B QA: real MuScriptor GGUF + original 15s music via approved Vite UI.
// Confirm exact same pitch/count timeline and non-uniform audio-derived velocity.
// THIS IS NOT a pedal detector; CC64 should remain absent.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from '/tmp/notiq-5b-playwright/node_modules/playwright-core/index.mjs';
import {createRequire} from 'node:module';
const midiRequire=createRequire(new URL('../../web/package.json',import.meta.url));
const {Midi}=midiRequire('@tonejs/midi');

const root=resolve('web/dist');
const server=createServer(async(req,res)=>{
  try{
    const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=resolve(join(root,p));
    if(file===root)file=join(root,'index.html');
    if(!file.startsWith(root+'/'))throw Error('Unsafe path');
    const bytes=await readFile(file);
    res.writeHead(200,{
      'Content-Type':file.endsWith('.wasm')?'application/wasm':
        /\.m?js$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp',
      'Cache-Control':'no-store'
    });
    res.end(bytes);
  }catch(e){res.writeHead(404);res.end(String(e));}
});
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=8192']});
function midiStats(buffer){
  // The real SMF decoder handles MIDI running status and meta events.
  const decoded=new Midi(new Uint8Array(buffer));
  const all=decoded.tracks.flatMap(track=>track.notes);
  const velocities=all.map(n=>Math.round(n.velocity*127));
  const cc64=decoded.tracks.reduce((total,t)=>
    total+(t.controlChanges?.sustain?.length||t.controlChanges?.[64]?.length||0),0);
  return{tracks:decoded.tracks.length,notes:all.length,
    uniqueVelocity:new Set(velocities).size,
    minVelocity:Math.min(...velocities),maxVelocity:Math.max(...velocities),
    maxOnsetTick:Math.max(...all.map(n=>n.ticks)),cc64,
    bytes:buffer.length};
}
try{
  const page=await browser.newPage({acceptDownloads:true});
  const errors=[],dynamics=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('crash',()=>errors.push('Browser renderer crashed'));
  page.on('console',m=>{
    const str=m.text();
    if(str.startsWith('NOTIQ_VELOCITY_ESTIMATE ')){
      const d=JSON.parse(str.slice('NOTIQ_VELOCITY_ESTIMATE '.length));
      dynamics.push(d);console.log('NOTIQ_REAL_VELOCITY_METRICS',JSON.stringify(d));
    }
    if(m.type()==='error')console.log('CHROME_ERROR',str.slice(0,220));
  });
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
  const cross=await page.evaluate(()=>self.crossOriginIsolated&&typeof SharedArrayBuffer==='function');
  if(!cross)throw Error('Missing pthread isolation');
  await page.locator('input[type=file]').setInputFiles('/tmp/notiq-5b-audio.wav');
  await page.getByRole('button',{name:'Tải mô hình AI'}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('MuScriptor AI Core: 451 nốt')
    ||document.body.innerText.includes('Không thể nhận diện bài hát'),null,{timeout:11*60*1000});
  const ui=await page.locator('body').innerText();
  if(!ui.includes('MuScriptor AI Core: 451 nốt'))throw Error('True MuScriptor output changed: '+ui.slice(-1200));
  if(!ui.includes('Velocity ước lượng từ audio'))throw Error('Preview does not disclose estimated dynamics');
  const transfer=page.waitForEvent('download');
  await page.getByRole('button',{name:'Xuất',exact:true}).first().click();
  await page.getByRole('button',{name:/MIDI đa track/}).click();
  const file=await transfer;
  const result=midiStats(await readFile(await file.path()));
  console.log('NOTIQ_5B_MIDI_STATS',JSON.stringify(result));
  if(result.notes!==451)throw Error('Expected exactly 451 native notes');
  if(result.uniqueVelocity<6||result.maxVelocity-result.minVelocity<15)
    throw Error('Real exported audio-derived MIDI still has near-flat velocity');
  if(result.cc64!==0)throw Error('Unexpected invented CC64 pedal');
  if(!dynamics.length||dynamics.at(-1).estimated<20)
    throw Error('Velocity analyzer did not estimate enough notes');
  if(errors.length)throw Error('Browser runtime errors: '+JSON.stringify(errors));
  console.log('NOTIQ_5B_REAL_AUDIO_EXPRESSIVE_VELOCITY_PASS');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
