// Stage 5B QA: real MuScriptor GGUF + original 15s music via approved Vite UI.
// Confirm exact same pitch/count timeline and non-uniform audio-derived velocity.
// THIS IS NOT a pedal detector; CC64 should remain absent.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from '/tmp/notiq-5b-playwright/node_modules/playwright-core/index.mjs';

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
  const a=new Uint8Array(buffer),ascii=(start,n)=>String.fromCharCode(...a.subarray(start,start+n));
  const u16=p=>a[p]*256+a[p+1];
  const u32=p=>(a[p]*16777216+a[p+1]*65536+a[p+2]*256+a[p+3])>>>0;
  if(ascii(0,4)!=='MThd'||u32(4)!==6||u16(8)!==1)throw Error('Invalid SMF header');
  const trackCount=u16(10),velocities=[],cc64=[],onsets=[];let pos=14;
  for(let t=0;t<trackCount;t++){
    if(ascii(pos,4)!=='MTrk')throw Error('Invalid MIDI track header');
    const end=pos+8+u32(pos+4);pos+=8;let running=0,ticks=0;
    const vlq=()=>{
      let x=0,z;do{if(pos>=end)throw Error('Truncated MIDI VLQ');z=a[pos++];x=(x<<7)|(z&127)}while(z&128);return x;
    };
    while(pos<end){
      ticks+=vlq();
      let code=a[pos++];if(code<128){if(!running)throw Error('Invalid running status');pos--;code=running;}
      else if(code<240)running=code;
      if(code===255){pos++;pos+=vlq();continue;}
      if(code===240||code===247){pos+=vlq();continue;}
      const kind=code&240,first=a[pos++],value=(kind===192||kind===208)?null:a[pos++];
      if(kind===144&&value>0){velocities.push(value);onsets.push(ticks);}
      if(kind===176&&first===64)cc64.push({tick:ticks,value});
    }
    if(pos!==end)throw Error('Corrupted MIDI track');
  }
  return{tracks:trackCount,notes:velocities.length,uniqueVelocity:[...new Set(velocities)].length,
    minVelocity:Math.min(...velocities),maxVelocity:Math.max(...velocities),
    maxOnsetTick:Math.max(...onsets),cc64:cc64.length,bytes:a.byteLength};
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
