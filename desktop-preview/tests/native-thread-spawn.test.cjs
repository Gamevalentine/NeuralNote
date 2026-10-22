'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {runBenchmark}=require('../benchmark-native.cjs');
function wav20(){
 const frames=20*16000;const b=new Uint8Array(44+frames*4);const d=new DataView(b.buffer);
 const f=(off,str)=>{for(let i=0;i<str.length;i++)d.setUint8(off+i,str.charCodeAt(i))};
 f(0,'RIFF');f(8,'WAVE');f(12,'fmt ');f(36,'data');
 d.setUint32(4,b.length-8,true);d.setUint32(16,16,true);d.setUint16(20,3,true);
 d.setUint16(22,1,true);d.setUint32(24,16000,true);
 d.setUint32(28,64000,true);d.setUint16(32,4,true);d.setUint16(34,32,true);
 d.setUint32(40,frames*4,true);return b;
}
test('benchmark invokes actual native subprocess with explicitly whitelisted thread setting',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'notiq-5mb-test-'));
 try{
  for(const n of [2,4,6]){
   let commandArgs=null;
   const job={cancelled:false,child:null};
   const r=await runBenchmark({
    wav:wav20(),seconds:20,startSeconds:0,threads:n,
    model:{id:'large',label:'Large F16'},modelPath:path.join(home,'test.gguf'),
    bridgeBinary:path.join(home,'notiq-native.exe'),dataDir:home,
    verifyModel:async()=>true,onProgress:()=>{},job,
    sampleProcess:()=>({stop:async()=>({samples:1,peakWorkingSetBytes:1024*1024,
      machineCpuPercent:12.5,cpuCoreEquivalent:1,logicalCores:8})}),
    runProcess:(_bin,args)=>{
     commandArgs=args;
     const child=new EventEmitter();child.pid=12345;child.stderr=new EventEmitter();
     child.stdout=new EventEmitter();child.kill=()=>{};
     setImmediate(async()=>{
      try{
       child.stderr.emit('data',Buffer.from('PROGRESS 3\nPROGRESS 20\nPROGRESS 98\n'));
       await fs.writeFile(args[2],JSON.stringify({schema:1,engine:'muscriptor',notes:[
        {pitchMidi:60,startTimeSeconds:0.2,durationSeconds:0.3,program:0}]}));
       child.emit('close',0);
      }catch(e){child.emit('error',e)}
     });
     return child;
    }
   });
   assert.equal(commandArgs[3],'--threads='+n);
   assert.equal(r.threadCount,n);
   assert.equal(r.notes,1);
   assert.equal(r.peakWorkingSetBytes,1024*1024);
   assert.equal(r.pcmSha256.length,64);
   assert.equal(r.notesSha256.length,64);
   assert.ok(r.loadMs!==null);
  }
 }finally{await fs.rm(home,{force:true,recursive:true})}
});
test('unsupported thread values reject BEFORE launching native CLI',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'notiq-5mb-guard-'));
 let spawned=false;
 try{
  await assert.rejects(runBenchmark({
   wav:wav20(),seconds:20,threads:8,model:{id:'large',label:'Large'},
   modelPath:'test.gguf',bridgeBinary:'binary.exe',dataDir:home,
   verifyModel:async()=>true,onProgress:()=>{},job:{cancelled:false},
   runProcess:()=>{spawned=true;throw Error('bad')}
  }),/2, 4 hoặc 6/);
  assert.equal(spawned,false);
 }finally{await fs.rm(home,{force:true,recursive:true})}
});
