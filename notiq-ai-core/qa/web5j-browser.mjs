import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '/tmp/notiq-5j-playwright/node_modules/playwright-core/index.mjs';
const requireWeb=createRequire(new URL('../../web/package.json',import.meta.url));
const {Midi}=requireWeb('@tonejs/midi');
const root=resolve('web/dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server=createServer(async(req,res)=>{
 try {
  const p=new URL(req.url,'http://localhost').pathname;
  const file=resolve(join(root,p==='/'?'index.html':decodeURIComponent(p).slice(1)));
  if(!file.startsWith(root+'/'))throw Error('Invalid path');
  const bytes=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream',
   'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
  res.end(bytes);
 }catch(error){res.writeHead(404);res.end(String(error))}
});
await new Promise(ok=>server.listen(4188,'127.0.0.1',ok));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const assert=(condition,message)=>{if(!condition)throw Error(message)};
try{
 await page.goto(process.env.NOTIQ_HOSTED_URL || 'http://127.0.0.1:4188/',{waitUntil:'domcontentloaded',timeout:45000});
 if(process.env.NOTIQ_HOSTED_URL){
   const isolated=await page.evaluate(()=>crossOriginIsolated&&typeof SharedArrayBuffer==='function');
   assert(isolated,'Cloudflare Preview missing cross-origin isolation needed by WASM MuScriptor');
 }
 assert(await page.getByText('AI: NOTIQ Core (WebAssembly)').count()>0,'Browser WASM AI must be clearly identified');
 await page.getByRole('button',{name:'Tệp',exact:true}).click();
 await page.getByRole('button',{name:'Dùng nhạc mẫu'}).click();
 await page.waitForFunction(()=>document.querySelector('audio')?.getAttribute('src')?.startsWith('blob:'));
 const open=page.getByRole('button',{name:'Mở kiểm tra MIDI chuẩn 5I'});
 await open.click();
 const section=page.getByRole('region',{name:'NOTIQ 5J đánh giá MIDI trên web'});
 await section.waitFor();
 assert((await section.innerText()).includes('MuScriptor Small'),'Web panel must disclose only Small AI');
 assert(!(await section.innerText()).includes('Dùng kết quả AI được đề xuất'),'Web must not present unsupported live second engine');
 const reference=new Midi();
 reference.addTrack().addNote({midi:60,time:1,duration:0.45,velocity:0.8});
 const valid=Buffer.from(reference.toArray());
 await section.locator('input[aria-label="Nạp MIDI chuẩn Web"]').setInputFiles({name:'my-piano.mid',mimeType:'audio/midi',buffer:valid});
 await section.getByText('my-piano.mid').waitFor();
 assert((await section.innerText()).includes('Đã nhận MIDI chuẩn'),'UI must explain that a recognized note stream is still required');
 await section.getByRole('combobox',{name:'Chế độ đánh giá Web'}).selectOption('piano');
 const second=Buffer.from(reference.toArray());
 await section.locator('input[aria-label="Nạp MIDI ứng viên Web"]').setInputFiles({name:'other-export.mid',mimeType:'audio/midi',buffer:second});
 await section.getByText('other-export.mid').waitFor();
 assert(!(await section.innerText()).includes('100.0%'),'Cannot fabricate F1 scores without web recognized notes');
 assert(!errors.length,'Chromium JavaScript errors: '+JSON.stringify(errors));
 await page.screenshot({path:'/tmp/notiq-stage5j-browser-panel.png',fullPage:true});
 console.log('NOTIQ_STAGE5J_BROWSER_UI_PASS reference-read=true model-small-disclosed=true no-fake-score=true');
}finally{
 await browser.close();await new Promise(ok=>server.close(ok))
}
