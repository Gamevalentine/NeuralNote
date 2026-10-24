'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {songSecondsFromWav,heartbeatInfo,safeFullSongReport}=require('../full-song-health.cjs');
const {createProcessSampler}=require('../process-metrics.cjs');
const framesWav=seconds=>{
 const frames=Math.round(seconds*16000),raw=new Uint8Array(44+frames*4),d=new DataView(raw.buffer);
 const ascii=(i,s)=>{for(let k=0;k<s.length;k++)raw[i+k]=s.charCodeAt(k)};
 ascii(0,'RIFF');ascii(8,'WAVE');ascii(12,'fmt ');ascii(36,'data');
 d.setUint32(4,raw.length-8,true);d.setUint32(16,16,true);
 d.setUint16(20,3,true);d.setUint16(22,1,true);
 d.setUint32(24,16000,true);d.setUint32(28,64000,true);
 d.setUint16(32,4,true);d.setUint16(34,32,true);d.setUint32(40,frames*4,true);
 return raw;
};
test('5NE 4 and 6 minute long song IEEE Float32 PCM are accepted without truncation',()=>{
 for(const seconds of [240,360]){
  const bytes=framesWav(seconds),d=new DataView(bytes.buffer);
  assert.equal(songSecondsFromWav(bytes),seconds);
  assert.equal(bytes.byteLength,44+seconds*64000);
  assert.equal(d.getUint32(40,true),seconds*64000);
 }
});
test('5NE rejects truncated long WAV and wrong channel/rate without synthesizing duration',()=>{
 const bytes=framesWav(240);
 assert.equal(songSecondsFromWav(bytes.subarray(0,bytes.length-8)),null);
 const badRate=bytes.slice();new DataView(badRate.buffer).setUint32(24,44100,true);
 assert.equal(songSecondsFromWav(badRate),null);
});
test('5NE after 0 progress for 13 minutes never manufactures percent',()=>{
 const now=13*60*1000,s=heartbeatInfo({nowMs:now,startedMs:0,lastProgressMs:0,percent:0,snapshot:null});
 assert.equal(s.percent,0);
 assert.equal(s.state,'no-progress');
 assert.equal(s.secondsWithoutProgress,780);
 assert.equal(s.ramBytes,null);
 assert.match(s.message,/Chưa có cập nhật/);
 assert.match(s.message,/chưa đo được/i);
});
test('5NE genuine process metrics distinguish slow model from missing instrumentation',()=>{
 const base={nowMs:120000,startedMs:0,lastProgressMs:20000,percent:12};
 const reading={samples:5,lastWorkingSetBytes:3*1024**3,peakWorkingSetBytes:4*1024**3,cpuCoreEquivalent:1.5};
 const s=heartbeatInfo({...base,snapshot:reading});
 assert.equal(s.state,'slow');
 assert.equal(s.percent,12);
 assert.equal(s.peakWorkingSetBytes,4*1024**3);
 assert.match(s.message,/4.00 GiB/);
 assert.match(s.message,/1.50 lõi/);
 const high=heartbeatInfo({...base,nowMs:200000,lastProgressMs:1000,snapshot:{...reading,peakWorkingSetBytes:13*1024**3}});
 assert.match(high.message,/16 GB/);
});
test('5NE report contains only metrics, not the recorded song or filesystem paths',()=>{
 const report=safeFullSongReport({model:'large',threadCount:4,seconds:360,elapsedMs:1934880,
  noteCount:3328,checkpointCount:70,resumed:true,
  stats:{samples:45,peakWorkingSetBytes:4*1024**3,cpuCoreEquivalent:2.1,machineCpuPercent:27}});
 assert.equal(report.schema,'notiq-5ne-fullsong-v1');
 assert.equal(report.songSeconds,360);
 assert.equal(report.peakNativeWorkingSetBytes,4*1024**3);
 assert.equal(report.fullSongNativeMeasured,true);
 assert.equal(JSON.stringify(report).includes('.wav'),false);
 assert.throws(()=>safeFullSongReport({model:'large',threadCount:8,seconds:360,elapsedMs:5,noteCount:1,checkpointCount:0,resumed:false}),/không hợp lệ/);
});
test('5NE live sampler without RAM readings never claims a fake peak',async()=>{
 const sampler=createProcessSampler(123,async()=>null,8);
 assert.equal(sampler.snapshot().peakWorkingSetBytes,null);
 assert.equal(sampler.snapshot().samples,0);
 const result=await sampler.stop();
 assert.equal(result.peakWorkingSetBytes,null);
});
