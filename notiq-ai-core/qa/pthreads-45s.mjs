// NOTIQ 45-second multi-threaded MuScriptor stress QA.
// Audio is a clearly labeled 3x repeat of the CC BY 4.0 original 15s fixture,
// not an independent recording or simulated note output.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { chromium } from '/tmp/notiq-pthreads45-playwright/node_modules/playwright-core/index.mjs';

const root='/tmp/notiq-45s-browser';
const web=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url||'/', 'http://localhost').pathname;
    const file=normalize(join(root,decodeURIComponent(pathname)));
    if(!file.startsWith(root+'/'))throw Error('Blocked unsafe path');
    const data=await readFile(file);
    res.writeHead(200,{
      'Content-Type':file.endsWith('.wasm')?'application/wasm':
        /\.(m?js)$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp',
      'Cross-Origin-Resource-Policy':'same-origin',
      'Cache-Control':'no-store',
    });
    res.end(data);
  } catch(e){res.writeHead(404);res.end(String(e));}
});
await new Promise(resolve=>web.listen(4173,'127.0.0.1',resolve));
const browser=await chromium.launch({
  executablePath:'/usr/bin/google-chrome',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=8192']
});
try{
  const page=await browser.newPage();
  page.on('pageerror',err=>console.error('NOTIQ_45S_PAGE_ERROR',err.message));
  page.on('crash',()=>console.error('NOTIQ_45S_CHROMIUM_CRASH'));
  await page.goto('http://127.0.0.1:4173/web/browser.html');
  if(!await page.evaluate(()=>self.crossOriginIsolated && typeof SharedArrayBuffer==='function'))
    throw Error('No SharedArrayBuffer isolation');
  await page.locator('#model').setInputFiles('/tmp/notiq-small.gguf');
  await page.locator('#audio').setInputFiles('/tmp/notiq-45s.wav');
  const started=Date.now();
  await page.locator('#run').click();
  await page.waitForFunction(()=>['complete','error'].includes(window.__notiqStage3?.state),null,{timeout:14*60*1000});
  const result=await page.evaluate(()=>window.__notiqStage3);
  if(result.state!=='complete')throw Error('45s original MuScriptor inference failed: '+JSON.stringify(result).slice(0,1300));
  if(result.audioSamples!==720000)throw Error('Not 45 seconds of actual PCM audio');
  if(!(result.notes>451)||!(result.midiLength>3840))throw Error('45-second MIDI events not present');
  if(result.result?.notes?.some(n=>n.startTimeSeconds>45.5))
    throw Error('MuScriptor predicted notes beyond fixture audio boundary');
  if(result.midiBytes?.slice(0,4).join(',')!=='77,84,104,100')throw Error('Missing MThd');
  console.log('NOTIQ_PTHREAD_45S_PASS',JSON.stringify({
    durationSeconds:45,fixture:'Original 15s licensed audio repeated 3x',
    samples:result.audioSamples,notes:result.notes,midiBytes:result.midiLength,
    wallMs:Date.now()-started,timings:result.timings,
    exactWasmEngine:'original pinned MuScriptor GGUF via pthread4'
  }));
}finally{
  await browser.close();
  await new Promise(resolve=>web.close(resolve));
}
