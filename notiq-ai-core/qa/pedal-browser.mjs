// Stage 5C regression: Chrome UI creates manual notes and exports real CC64 control
// changes. This does NOT test AI transcription, physical sustain audio, or Kontakt.
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve, extname} from 'node:path';
import {chromium} from '/tmp/notiq-5c-playwright/node_modules/playwright-core/index.mjs';
import {createRequire} from 'node:module';
const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
const {Midi} = requireWeb('@tonejs/midi');
const {unzipSync} = requireWeb('fflate');
const root=resolve('web/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    const filename=path==='/'?'index.html':decodeURIComponent(path).replace(/^\/+/, '');
    const file=resolve(join(root,filename));
    if(!file.startsWith(root+'/'))throw new Error('Unsafe path');
    const bytes=await readFile(file);
    res.writeHead(200,{
      'Content-Type':mime[extname(file)]||'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp',
      'Cache-Control':'no-store'
    });res.end(bytes);
  }catch(e){res.writeHead(404);res.end(String(e))}
});
await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:920},acceptDownloads:true});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('crash',()=>errors.push('Chromium renderer crashed'));
function summary(bytes){
  const file=new Midi(bytes);
  return file.tracks.map(t=>({
    name:t.name, program:t.instrument.number, channel:t.channel,
    notes:t.notes.map(n=>({midi:n.midi,time:n.time,duration:n.duration,velocity:n.velocity})),
    pedal:(t.controlChanges[64]||[]).map(c=>({time:c.time,value:Math.round(c.value*127)}))
  }));
}
async function exportVia(menuPattern,ext){
  const download=page.waitForEvent('download',{timeout:10000});
  await page.getByRole('button',{name:'Xuất',exact:true}).first().click();
  await page.locator('.menu-dropdown button').filter({hasText:menuPattern}).first().click();
  const file=await download;
  if(!file.suggestedFilename().endsWith(ext))throw Error('Unexpected exported file: '+file.suggestedFilename());
  return new Uint8Array(await readFile(await file.path()));
}
function ensure(condition,msg){if(!condition)throw Error(msg)}
try{
  await page.goto('http://127.0.0.1:4175/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('.roll.piano-editable').waitFor();
  ensure(await page.getByRole('group',{name:'Biên tập pedal MIDI CC64'}).isVisible(),'CC64 toolbar not visible');
  // Local, human-style note entry in the piano roll; no fake AI output.
  await page.locator('.roll.piano-editable').click({position:{x:115,y:385}});
  await page.locator('.roll.piano-editable').click({position:{x:390,y:175}});
  await page.waitForFunction(()=>document.querySelectorAll('.editable-note').length===2);
  const untouched=summary(await exportVia('MIDI đa track','.mid'));
  ensure(untouched.length===2,'Expected two separate pitch-range tracks');
  ensure(untouched.every(t=>t.notes.length===1 && t.pedal.length===0),'Notes-only MIDI baseline changed');
  const mid=untouched.find(t=>t.name.includes('Mid'));
  const high=untouched.find(t=>t.name.includes('High'));
  ensure(mid&&high,'Expected high and mid tracks');
  const originalNotes=JSON.stringify(untouched.map(t=>({name:t.name,notes:t.notes})));
  await page.getByRole('combobox',{name:'Track nhận pedal'}).selectOption('pitch-mid');
  await page.getByRole('button',{name:'1s',exact:true}).click();
  await page.getByRole('button',{name:/^Đạp tại/}).click();
  await page.getByRole('button',{name:'2s',exact:true}).click();
  await page.getByRole('button',{name:/^Nhả tại/}).click();
  ensure(await page.locator('.pedal-marker').count()===2,'Pedal markers missing from UI');
  await page.screenshot({path:'/tmp/notiq-5c-pedal-qa.png',fullPage:true});
  const demoMidi=await exportVia('MIDI đa track','.mid');
  await writeFile('/tmp/notiq-5c-cc64-demo.mid',demoMidi);
  const after=summary(demoMidi);
  ensure(JSON.stringify(after.map(t=>({name:t.name,notes:t.notes})))===originalNotes,'Pedal unexpectedly changed notes');
  const onTrack=after.find(t=>t.name.includes('Mid'));
  const offTrack=after.find(t=>t.name.includes('High'));
  ensure(onTrack.pedal.length===2,'Mid CC64 messages not exported');
  ensure(offTrack.pedal.length===0,'Pedal leaked to untargeted high track');
  ensure(onTrack.pedal[0].value===127 && onTrack.pedal[1].value===0,'Wrong CC64 values');
  ensure(Math.abs(onTrack.pedal[0].time-1)<0.003 && Math.abs(onTrack.pedal[1].time-2)<0.003,'CC64 timeline positions shifted');
  const demoZip=await exportVia('Gói MIDI từng track','.zip');
  await writeFile('/tmp/notiq-5c-kontakt-stems.zip',demoZip);
  const zip=unzipSync(demoZip);
  const all=summary(zip['NOTIQ_ALL_TRACKS.mid']);
  ensure(all.find(t=>t.name.includes('Mid')).pedal.length===2,'ZIP all-tracks lost pedal');
  const stems=Object.keys(zip).filter(name=>name.startsWith('MIDI_TRACKS/') && name.endsWith('.mid'));
  ensure(stems.length===2,'Expected two isolated MIDI stems');
  ensure(stems.map(name=>summary(zip[name])[0]).filter(t=>t.pedal.length===2).length===1,'Isolated track CC64 incorrect');
  // Remove down marker and verify no dangling OFF is saved; clear UI then re-export.
  await page.locator('.pedal-marker.pedal-on').click();
  ensure(await page.locator('.pedal-marker').count()===1,'Removing a CC64 event did not update UI');
  await page.getByRole('button',{name:'Xóa pedal'}).click();
  ensure(await page.locator('.pedal-marker').count()===0,'Clear CC64 did not empty UI');
  const clean=summary(await exportVia('MIDI đa track','.mid'));
  ensure(clean.every(t=>t.pedal.length===0),'Clear CC64 leaked controller events to exported MIDI');
  ensure(JSON.stringify(clean.map(t=>({name:t.name,notes:t.notes})))===originalNotes,'Clearing CC64 edited note contents');
  ensure(errors.length===0,'Browser errors: '+JSON.stringify(errors));
  const result={status:'PASS',browser:'Chrome headless',scope:'manual notes + CC64 UI + MIDI Type1 + ZIP stems, not AI/piano sound',head:process.env.GITHUB_SHA,
    notes:untouched.reduce((n,t)=>n+t.notes.length,0),tracks:untouched.length,cc64Tested:true,
    pedalTrack:onTrack.name,pedalTimes:onTrack.pedal.map(p=>p.time),pedalValues:onTrack.pedal.map(p=>p.value),
    noPedalAfterClear:true,unchangedNotes:true,jsErrors:errors};
  await writeFile('/tmp/notiq-5c-pedal-results.json',JSON.stringify(result,null,2));
  console.log('NOTIQ_STAGE5C_CHROME_CC64_PASS',JSON.stringify(result));
}catch(error){
  await page.screenshot({path:'/tmp/notiq-5c-failure.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
