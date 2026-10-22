'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {cpuThreadCount,fingerprintPCM,sameBenchmarkClip}=require('../cpu-threads.cjs');
test('Only 2 4 6 CPU threads accepted: never interpolate or accept user process args',()=>{
 for(const k of [2,4,6])assert.equal(cpuThreadCount(k),k);
 for(const k of [0,1,3,8,24,'4','4; del C:\\',null,NaN])
  assert.throws(()=>cpuThreadCount(k),/2, 4 hoặc 6/);
});
test('identical PCM bytes create stable hash, shifted clip distinct',()=>{
 const a=fingerprintPCM(new Uint8Array([1,2,3]));
 const b=fingerprintPCM(new Uint8Array([1,2,3]));
 const c=fingerprintPCM(new Uint8Array([1,2,4]));
 assert.equal(a,b);assert.notEqual(a,c);assert.equal(a.length,64);
});
test('only compare same model/start/duration and exact input clip',()=>{
 const a={model:'large',clipSeconds:20,startSeconds:0,pcmSha256:fingerprintPCM(Buffer.from('same'))};
 assert.equal(sameBenchmarkClip(a,{...a,threadCount:4}),true);
 assert.equal(sameBenchmarkClip(a,{...a,model:'small'}),false);
 assert.equal(sameBenchmarkClip(a,{...a,startSeconds:1}),false);
 assert.equal(sameBenchmarkClip(a,{...a,pcmSha256:fingerprintPCM(Buffer.from('different'))}),false);
});
