// Stage 5 pthreads A/B benchmark. Only serves trusted local test artifacts.
// COOP/COEP are required for SharedArrayBuffer and wasm32 pthread support.
// No GGUF weights or original WAV are copied to NOTIQ/GitHub.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { chromium } from '/tmp/notiq-pthreads-playwright/node_modules/playwright-core/index.mjs';

const root='/tmp/notiq-pthreads-ab';
const server=createServer(async (req,res)=>{
  try {
    const pathname=new URL(req.url||'/', 'http://localhost').pathname;
    const file=normalize(join(root,decodeURIComponent(pathname)));
    if(!file.startsWith(root+'/'))throw Error('invalid path');
    const bytes=await readFile(file);
    const ext=file.split('.').pop();
    const mime=ext==='wasm'?'application/wasm':ext==='js'||ext==='mjs'?'text/javascript':ext==='html'?'text/html':'application/octet-stream';
    res.writeHead(200,{
      'Content-Type':mime,
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp',
      'Cross-Origin-Resource-Policy':'same-origin',
      'Cache-Control':'no-store',
    });
    res.end(bytes);
  } catch(err){res.writeHead(404);res.end(String(err));}
});
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
console.log('NOTIQ_CROSS_ORIGIN_ISOLATION_SERVER_READY');
const browser=await chromium.launch({
  executablePath:'/usr/bin/google-chrome',
  headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=8192']
});
const outputs=[];
try {
  for (const name of ['baseline','pthread4']) {
    const ctx=await browser.newContext();
    try {
      const page=await ctx.newPage();
      page.on('pageerror',error=>console.log(name,'PAGE_ERROR',error.message));
      page.on('console',message=>{
        if(message.type()==='error')console.log(name,'CHROME_ERROR',message.text().slice(0,300));
      });
      page.on('crash',()=>console.log(name,'RENDERER_CRASH'));
      await page.goto('http://127.0.0.1:4173/'+name+'/web/browser.html',{waitUntil:'domcontentloaded'});
      const isolation=await page.evaluate(()=>({
        isolated:self.crossOriginIsolated,
        sab:typeof SharedArrayBuffer==='function',
        cores:navigator.hardwareConcurrency
      }));
      console.log('NOTIQ_ISOLATION',name,JSON.stringify(isolation));
      if(!isolation.isolated||!isolation.sab)throw Error('Cross-origin isolation missing');
      await page.locator('#model').setInputFiles('/tmp/notiq-small.gguf');
      await page.locator('#audio').setInputFiles('/tmp/notiq-original-15s.wav');
      const start=Date.now();
      await page.locator('#run').click();
      await page.waitForFunction(()=>['complete','error'].includes(window.__notiqStage3?.state),null,{timeout:10*60*1000});
      const result=await page.evaluate(()=>window.__notiqStage3);
      console.log('NOTIQ_PTHREAD_RUN',name,JSON.stringify({
        status:result.state,statusText:await page.locator('#status').innerText(),
        noteCount:result.notes,wallMs:Date.now()-start,timings:result.timings
      }));
      if(result.state!=='complete'||result.notes!==451||!result.result?.notes?.length)
        throw Error(name+' did not return 451 true MuScriptor notes');
      outputs.push({name,notes:result.result.notes,wallMs:Date.now()-start,timings:result.timings});
    } finally {
      await ctx.close();
    }
  }
  if(JSON.stringify(outputs[0].notes)!==JSON.stringify(outputs[1].notes))
    throw Error('PTHREAD 4-CORE CHANGED NOTE JSON; reject candidate');
  const inference=r=>r.timings.findLast(x=>x.notes===451)?.durationMs??r.wallMs;
  const before=inference(outputs[0]), after=inference(outputs[1]);
  const percent=Number(((before-after)/before*100).toFixed(2));
  console.log('NOTIQ_PTHREADS_RESULT',JSON.stringify({
    baselineMs:before,pthread4Ms:after,gainPercent:percent,
    noteEvents:451,exactlySameNotes:true,meaningfulSpeedup:percent>=15
  }));
  if(percent<15)console.log('NOTIQ_PTHREADS_DECISION keep baseline; speedup below 15%');
  else console.log('NOTIQ_PTHREADS_DECISION promising; 45s+ RAM QA needed before integrating');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
