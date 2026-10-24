'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {MODELS}=require('../models.cjs');
const {safeFullSongReport}=require('../full-song-health.cjs');
const {finalReadiness,validateQualityPacket}=require('../final-review-5pc.cjs');
const h=i=>i.toString(16).padStart(2,'0').repeat(32);
const run=(song,threads)=>safeFullSongReport({
 model:'large',threadCount:threads,seconds:300,elapsedMs:1700000,
 noteCount:1300,checkpointCount:43,resumed:threads===4,stats:{
 samples:15,peakWorkingSetBytes:4*1024**3,cpuCoreEquivalent:2.2
 },audioSha256:h(song),notesSha256:h(80),
 modelSha256:MODELS.large.sha256
});
const reports=[1,2].flatMap(song=>[2,4,6].map(threads=>run(song,threads)));
const quality=song=>({
 schema:'notiq-5pc-quality-v1',
 samePerformanceConfirmed:true,
 audioSha256:h(song),currentModelNotesSha256:h(80),
 referenceSha256:h(3),currentMidiSha256:h(4),baselineMidiSha256:h(5),
 baseline:{truePositive:100,falsePositive:10,falseNegative:10},
 current:{truePositive:102,falsePositive:8,falseNegative:8},
 onsetMeanAbsoluteMs:23,offsetMeanAbsoluteMs:60
});
const review={ownPlaybackReviewed:true,velocityPedalReviewed:true,
 deviceResponsive:true,checkpointBoundaryChecked:true};
const flags={sourceBuildPass:true,portableIntegrityPass:true,windowsLaunchVerified:true};
test('5PC: no native inference / same-performance MIDI / launch => unconditional HOLD',()=>{
 const a=finalReadiness([],[],null);
 assert.equal(a.releaseApproved,false);assert.equal(a.status,'HOLD');
 assert.ok(a.blockers.length>=4);
 assert.equal(a.qualityPacketsAccepted,0);
});
test('5PC: valid complete synthetic data is never a production authorization',()=>{
 const a=finalReadiness(reports,[quality(1),quality(2)],review,flags);
 assert.equal(a.status,'READY_FOR_OWNER_REVIEW');
 assert.equal(a.candidateRelease,false);assert.equal(a.releaseApproved,false);
 assert.equal(a.independentSongs,2);assert.equal(a.nativeRunsAccepted,6);
});
test('5PC: apparent perfect scores without same-performance confirmation are blocked',()=>{
 const q=quality(1);q.samePerformanceConfirmed=false;
 const a=finalReadiness(reports,[q,quality(2)],review,flags);
 assert.equal(a.status,'HOLD');assert.equal(a.qualityPacketsRejected,1);
 assert.match(a.blockers.join(' '),/MIDI cùng bản diễn/);
});
test('5PC: missing Windows GUI launch blocks even with every synthetic score supplied',()=>{
 const a=finalReadiness(reports,[quality(1),quality(2)],review,{
  ...flags,windowsLaunchVerified:false});
 assert.equal(a.status,'HOLD');assert.match(a.blockers.join(' '),/Windows/);
});
test('5PC: wrong result fingerprint cannot be applied to another inference run',()=>{
 const a=quality(1);a.currentModelNotesSha256=h(44);
 const result=finalReadiness(reports,[a,quality(2)],review,flags);
 assert.equal(result.status,'HOLD');
 assert.match(result.blockers.join(' '),/MIDI chuẩn/);
});
test('5PC: decline missing listening review or pedal check',()=>{
 const a=finalReadiness(reports,[quality(1),quality(2)],{
  ...review,velocityPedalReviewed:false},flags);
 assert.equal(a.status,'HOLD');assert.equal(a.review.velocityPedalReviewed,false);
});
test('5PC: invalid scores and maliciously huge files rejected, no arbitrary payload accepted',()=>{
 const q=quality(1);q.current={truePositive:-1,falsePositive:0,falseNegative:0};
 assert.throws(()=>validateQualityPacket(q),/TP\/FP\/FN/);
 assert.throws(()=>finalReadiness(reports,Array.from({length:9},()=>quality(1)),review,flags),/8/);
 const malformed=quality(1);malformed.referenceSha256='../../secret';
 assert.equal(finalReadiness(reports,[malformed],review,flags).qualityPacketsRejected,1);
});
test('5PC: archive checksum pass alone cannot imply completed Large inference',()=>{
 const a=finalReadiness([],[],null,{sourceBuildPass:true,portableIntegrityPass:true});
 assert.equal(a.status,'HOLD');assert.equal(a.independentSongs,0);
});
