'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeClip}=require('../wav-benchmark.cjs');
const {parseWindowsSample,createProcessSampler}=require('../process-metrics.cjs');
function wav(seconds){
 const frames=seconds*16000,b=new Uint8Array(44+frames*4),v=new DataView(b.buffer);
 for(const [offset,txt]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])
  for(let i=0;i<txt.length;i++)v.setUint8(offset+i,txt.charCodeAt(i));
 v.setUint32(4,b.length-8,true);v.setUint32(16,16,true);v.setUint16(20,3,true);
 v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,64000,true);
 v.setUint16(32,4,true);v.setUint16(34,32,true);v.setUint32(40,frames*4,true);
 for(let i=0;i<frames;i++)v.setFloat32(44+i*4,i/frames,true);
 return b;
}
test('20, 30 and 60 second benchmark WAV clips preserve exact IEEE Float32 framing',()=>{
 const full=wav(100);const source=new DataView(full.buffer);
 for(const seconds of [20,30,60]){
  const clip=makeClip(full,seconds,12);
  const view=new DataView(clip.buffer);
  assert.equal(view.getUint32(4,true),clip.byteLength-8);
  assert.equal(view.getUint32(40,true),seconds*64000);
  assert.equal(view.getUint32(24,true),16000);
  assert.equal(view.getFloat32(44,true),source.getFloat32(44+12*64000,true));
  assert.equal(view.getFloat32(clip.length-4,true),source.getFloat32(44+(12+seconds)*64000-4,true));
 }
});
test('reject invalid clip duration, missing PCM frames and clip beyond end',()=>{
 const full=wav(100);
 assert.throws(()=>makeClip(full,15,0),/Benchmark chỉ hỗ trợ/);
 assert.throws(()=>makeClip(full,60,50),/vượt/);
 assert.throws(()=>makeClip(full.subarray(0,full.byteLength-4),20,0),/kích thước/);
 const corrupt=full.slice();new DataView(corrupt.buffer).setUint16(20,1,true);
 assert.throws(()=>makeClip(corrupt,20,0),/Float32/);
});
test('parse sampled CPU/RAM only when all three numbers are present',()=>{
 assert.deepEqual(parseWindowsSample('12.5|104857600|209715200\r\n'),
  {cpuSeconds:12.5,workingSetBytes:104857600,peakWorkingSetBytes:209715200});
 assert.deepEqual(parseWindowsSample('12,5|104857600|209715200'),
  {cpuSeconds:12.5,workingSetBytes:104857600,peakWorkingSetBytes:209715200});
 assert.equal(parseWindowsSample('10|x|100'),null);
});
test('no resource metrics supplied => never fabricate RAM or CPU',async()=>{
 const monitor=createProcessSampler(12345,async()=>null,8);
 const result=await monitor.stop();
 assert.equal(result.samples,0);
 assert.equal(result.peakWorkingSetBytes,null);
 assert.equal(result.machineCpuPercent,null);
});
