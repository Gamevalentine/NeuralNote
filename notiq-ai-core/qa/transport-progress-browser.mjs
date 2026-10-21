// UI-only automated QA: the native bridge is explicitly mocked in Chromium.
// No AI model is run; this tests UX while inference is pending and playback controls.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {chromium} from '/tmp/notiq-5d-playwright/node_modules/playwright-core/index.mjs';
const root=resolve('web/dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server=createServer(async(req,res)=>{
 try{
  const p=new URL(req.url,'http://localhost').pathname;
  const filename=p==='/'?'index.html':decodeURIComponent(p).replace(/^\\/+/, '');
  const file=resolve(join(root,filename));
  if(!file.startsWith(root+'/'))throw Error('Invalid static path');
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
  res.end(body);
 }catch(e){res.writeHead(404);res.end(String(e))}
});
await new Promise(resolve=>server.listen(4179,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:900},acceptDownloads:true});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('crash',()=>errors.push('Chrome renderer crashed'));
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
function wav(seconds=4){
 const rate=16000,n=rate*seconds,b=Buffer.alloc(44+n*2);
 b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);
 b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
 b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*1400),44+i*2);
 return b;
}
const fixture=wav();
try{
 await page.addInitScript(()=>{
  let subscriber=null;
  window.notiqNative={
   status:async()=>({available:true,modelInstalled:true,busy:false,downloading:false,modelBytes:209425152,modelLocation:'test',license:'QA MOCK'}),
   downloadModel:async()=>({available:true,modelInstalled:true,busy:false,downloading:false}),
   onProgress:handler=>{subscriber=handler;return ()=>{subscriber=null}},
   transcribe:async()=>{
    await new Promise(r=>setTimeout(r,450));
    subscriber?.({kind:'transcribe',percent:15,message:'MuScriptor đang nhận diện nốt thật (QA mô phỏng bridge)'});
    await new Promise(r=>setTimeout(r,2200));
    return {schema:1,engine:'muscriptor',notes:[{pitchMidi:69,startTimeSeconds:0.2,durationSeconds:0.8,program:0,isDrum:false,amplitude:0.7}]};
   }
  };
 });
 await page.goto('http://127.0.0.1:4179/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('.notiq-ai-mode')?.textContent.includes('MuScriptor (Windows)'));
 const transport=page.getByRole('group',{name:'Điều khiển phát lại'});
 assert(await transport.isVisible(),'Transport missing');
 assert(await page.getByRole('button',{name:'Phát',exact:true}).isDisabled(),'Play should be disabled without notes/audio');
 await page.locator('input[type=file]').setInputFiles({name:'qa-piano.wav',mimeType:'audio/wav',buffer:fixture});
 const overlay=page.getByRole('status',{name:'Tiến trình nhận diện nốt'});
 await overlay.waitFor({timeout:12000});
 const notice=await overlay.innerText();
 assert(notice.includes('NOTIQ đang nhận diện âm thanh'),'Centered recognition title missing');
 assert(notice.includes('Đã chạy:'),'Elapsed time missing');
 assert(notice.includes('chưa cung cấp %'),'No disclosure of indeterminate progress');
 assert(await page.getByRole('button',{name:'Phát',exact:true}).isDisabled(),'Play should be disabled during recognition');
 await page.waitForFunction(()=>document.querySelector('.notiq-ai-card')?.innerText.includes('Giai đoạn 2/2'),null,{timeout:10000});
 await page.screenshot({path:'/tmp/notiq-5d-progress-overlay.png',fullPage:true});
 await overlay.waitFor({state:'hidden',timeout:15000});
 assert((await page.locator('.editable-note').count())===1,'Mocked completed result was not displayed');
 // Explicitly select only the original audio: no SoundFont network download needed.
 await page.getByRole('button',{name:'Phát lại',exact:true}).click();
 await page.locator('#playmode-menu').selectOption('original');
 await page.getByRole('button',{name:'Phát',exact:true}).click();
 await page.getByRole('button',{name:'Tạm dừng',exact:true}).waitFor({timeout:10000});
 await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>0.3,null,{timeout:8000});
 await page.getByRole('button',{name:'Tạm dừng',exact:true}).click();
 const paused=await page.locator('audio').evaluate(a=>({paused:a.paused,time:a.currentTime}));
 await page.waitForTimeout(240);
 const stillPaused=await page.locator('audio').evaluate(a=>({paused:a.paused,time:a.currentTime}));
 assert(paused.paused && stillPaused.paused && Math.abs(paused.time-stillPaused.time)<0.07,'Pause did not hold audio time');
 await page.getByRole('button',{name:'Phát',exact:true}).click();
 await page.getByRole('button',{name:'Tạm dừng',exact:true}).waitFor({timeout:8000});
 await page.waitForFunction(t=>document.querySelector('audio')?.currentTime>t+0.1,paused.time,{timeout:5000});
 await page.getByRole('button',{name:'Dừng',exact:true}).click();
 const stopped=await page.locator('audio').evaluate(a=>({paused:a.paused,time:a.currentTime}));
 assert(stopped.paused&&stopped.time<0.06,'Stop did not pause and rewind audio');
 await page.getByRole('button',{name:'Phát lặp'}).click();
 assert(await page.getByRole('button',{name:'Phát lặp'}).getAttribute('aria-pressed')==='true','Loop toggle did not work');
 await page.screenshot({path:'/tmp/notiq-5d-transport.png',fullPage:true});
 await page.getByRole('button',{name:'Đóng bài hát'}).click();
 assert(await page.getByRole('button',{name:'Phát',exact:true}).isDisabled(),'Play should be disabled after close file');
 assert(!await page.getByRole('button',{name:'Đóng bài hát'}).count(),'Close should clear loaded file');
 assert(errors.length===0,'Browser errors: '+JSON.stringify(errors));
 const report={status:'PASS',testing:'React UI + mock native bridge; NO real MuScriptor, NO actual Kontakt audio',sha:process.env.GITHUB_SHA,
 overlay:true,elapsedDisplay:true,stage2:true,transport:true,pauseRetainsPosition:true,resume:true,stopRewinds:true,closeClears:true,errors};
 await writeFile('/tmp/notiq-5d-report.json',JSON.stringify(report,null,2));
 console.log('NOTIQ_STAGE5D_UI_PASS',JSON.stringify(report));
} catch(e) {
 await page.screenshot({path:'/tmp/notiq-5d-error.png',fullPage:true}).catch(()=>{});
 throw e;
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
