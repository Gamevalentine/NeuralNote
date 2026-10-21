'use strict';
// Real Windows first-install test. Downloads official pinned uv, Python 3.11,
// CPU PyTorch, Transkun 2.0.1 and its packaged checkpoint into runner's
// isolated NOTIQ-Data. No user disk or global Python environment is changed.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const runtime=require('../transkun-runtime.cjs');
function demoWave(){
 const frames=16000*2,b=Buffer.alloc(44+frames*4);
 b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);
 b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(3,20);
 b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(64000,28);
 b.writeUInt16LE(4,32);b.writeUInt16LE(32,34);b.write('data',36);
 b.writeUInt32LE(frames*4,40);
 for(let i=0;i<frames;i++){
  const t=i/16000;
  b.writeFloatLE(Math.sin(2*Math.PI*440*t)*0.24*Math.exp(-t*1.1),44+i*4);
 }
 return b;
}
(async()=>{
 if(process.platform!=='win32')throw Error('Only the Windows runner is allowed for this installer QA');
 const data=path.join(process.env.RUNNER_TEMP||os.tmpdir(),'NOTIQ-Data-Stage5G');
 const runner=fs.readFileSync(path.join(__dirname,'../transkun-runner.py'),'utf8');
 const setup=await runtime.setup(data,runner,msg=>console.log('PIANO_INSTALL_PROGRESS',msg));
 assert.equal(setup.ready,true);
 assert.equal(await runtime.installed(runtime.localPaths(data)),true);
 const result=await runtime.transcribe(data,demoWave(),runner,msg=>console.log('PIANO_RUNTIME_PROGRESS',msg));
 assert.equal(result.schema,1);
 assert.equal(result.engine,'transkun-v2');
 assert.ok(Array.isArray(result.notes));
 assert.ok(Array.isArray(result.pedalEvents));
 await fsp.writeFile(path.join(data,'real-windows-smoke.json'),JSON.stringify({
   engine:result.engine,notes:result.notes.length,pedalEvents:result.pedalEvents.length,
   setup:'official-pinned-checkpoint',windowsNative:true
 },null,2));
 console.log('NOTIQ_STAGE5G_WINDOWS_REAL_TRANSKUN_PASS notes='+result.notes.length);
})().catch(error=>{console.error(error);process.exitCode=1});
