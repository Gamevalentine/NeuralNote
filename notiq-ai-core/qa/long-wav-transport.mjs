import { chromium } from '/tmp/notiq-5d-playwright/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
const root=resolve('web/dist');
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'),p=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const filename=resolve(join(root,p));
    if(!filename.startsWith(root+'/'))throw Error('Invalid path');
    const data=await readFile(filename);
    res.setHeader('Content-Type',extname(filename)==='.js'?'text/javascript':extname(filename)==='.css'?'text/css':'text/html');
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.end(data);
  }catch(e){res.writeHead(404);res.end(String(e))}
});
await new Promise(ok=>server.listen(4186,'127.0.0.1',ok));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 await page.addInitScript(()=>{
   window.notiqNative={
     status:async()=>({available:true,modelInstalled:true}),
     onProgress:()=>()=>{},
     transcribe:async()=>({schema:1,engine:'muscriptor',notes:Array.from({length:815},(_,i)=>({
       pitchMidi:60+i%12,program:0,isDrum:false,amplitude:0.8,
       startTimeSeconds:0.1+i*269.5/815,durationSeconds:0.24
     }))})
   };
 });
 const rate=8000,n=Math.floor(269.84*rate),b=Buffer.alloc(44+n*2);
 b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);
 b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 await page.goto('http://127.0.0.1:4186/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('.notiq-ai-mode')?.textContent.includes('Windows'));
 await page.locator('input[type=file]').setInputFiles({name:'long.wav',mimeType:'audio/wav',buffer:b});
 await page.waitForFunction(()=>document.querySelectorAll('.editable-note').length===815,null,{timeout:90000});
 const transport=page.getByRole('group',{name:'Điều khiển phát lại'});
 if(await page.getByRole('combobox',{name:'Chế độ nghe'}).inputValue()!=='midi')throw Error('MIDI not default');
 await transport.getByRole('button',{name:'Phát',exact:true}).click();
 await transport.getByRole('button',{name:'Tạm dừng',exact:true}).waitFor({timeout:60000});
 await page.waitForFunction(()=>Number(document.querySelector('.notiq-transport-clock')?.textContent?.match(/:(\d+)\./)?.[1]||0)>=2,null,{timeout:60000});
 if(!(await page.locator('audio').evaluate(a=>a.paused)))throw Error('MIDI mode triggered source audio playback');
 console.log('NOTIQ_STAGE5E_4MIN_CLOCK_PASS',await transport.locator('.notiq-transport-clock').innerText());
 await transport.getByRole('button',{name:'Tạm dừng',exact:true}).click();
 const paused=await transport.locator('.notiq-transport-clock').innerText();
 await page.waitForTimeout(250);
 if(await transport.locator('.notiq-transport-clock').innerText()!==paused)throw Error('Pause did not freeze clock');
 await transport.getByRole('button',{name:'Phát',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('.notiq-transport-clock')?.textContent?.match(/:(\d+)\./)?.[1]||0)>=3,null,{timeout:15000});
 await transport.getByRole('button',{name:'Dừng'}).click();
 if(!(await transport.locator('.notiq-transport-clock').innerText()).startsWith('00:00.00'))throw Error('Stop did not rewind');
 if(errors.length)throw Error('Page errors: '+JSON.stringify(errors));
 console.log('NOTIQ_STAGE5E_TRANSPORT_PASS');
}finally {
 await browser.close();
 await new Promise(ok=>server.close(ok));
}
