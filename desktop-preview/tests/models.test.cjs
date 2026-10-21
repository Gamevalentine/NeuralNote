'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {MODELS,getModel}=require('../models.cjs');
const {hasVerifiedModel,downloadVerifiedModel}=require('../model-download.cjs');
test('Only authentic pinned Small and Large MuScriptor v1 checkpoints, never fabricated 4 GB weights',()=>{
 assert.deepEqual(Object.keys(MODELS).sort(),['large','small']);
 assert.equal(getModel('large').bytes,2739142176);
 assert.equal(getModel('large').sha256,'35a750fb1ab1e77195cdc2c0b9b4aeea2f4d59f11f729f02af9920c4854ef72e');
 assert.match(getModel('large').url,/d7045f94e8b19427f4ff9542975035e66596e51c\/v1\/muscriptor-large-f16\.gguf$/);
 assert.throws(()=>getModel('4gb'),/checkpoint/);
 assert.throws(()=>getModel('../../'),/checkpoint/);
});
test('Streams GGUF with checksum verification and supports a correct HTTP 206 resumed partial',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notiq-model-test-'));
 try {
  const dest=path.join(dir,'models','test.gguf'),data=Buffer.from('verified small model fixture for transfer tests');
  const model={url:'https://example.invalid/v1/test.gguf',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
  const fetchFull=async()=>new Response(data,{status:200,headers:{'content-type':'application/octet-stream'}});
  const result=await downloadVerifiedModel(model,dest,()=>{},fetchFull);
  assert.equal(result.alreadyInstalled,false);
  assert.equal(await hasVerifiedModel(model,dest),true);
  await fs.rm(dest);
  await fs.writeFile(dest+'.partial',data.subarray(0,12));
  let sawRange='';
  const resume=async(_url,opts)=>{
   sawRange=opts.headers.Range;
   return new Response(data.subarray(12),{status:206,headers:{'content-range':'bytes 12-'+(data.length-1)+'/'+data.length}});
  };
  await downloadVerifiedModel(model,dest,()=>{},resume);
  assert.equal(sawRange,'bytes=12-');
  assert.deepEqual(await fs.readFile(dest),data);
 } finally {await fs.rm(dir,{recursive:true,force:true})}
});
test('Rejects corrupted bytes and cannot install incorrect SHA-256 data',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'notiq-checksum-test-'));
 try {
  const target=path.join(dir,'model.gguf');
  const model={url:'https://example.invalid/model',bytes:4,sha256:'a'.repeat(64)};
  await assert.rejects(downloadVerifiedModel(model,target,()=>{},async()=>new Response('ABCD')),/SHA-256/);
  await assert.rejects(fs.stat(target),{code:'ENOENT'});
  await assert.rejects(fs.stat(target+'.partial'),{code:'ENOENT'});
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
