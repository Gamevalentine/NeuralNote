'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {audit5PB,validRun}=require('../acceptance-5pb.cjs');
const {MODELS}=require('../models.cjs');
const {safeFullSongReport}=require('../full-song-health.cjs');
const hashes=[('ab'.repeat(32)),('cd'.repeat(32))];
const modelSha=MODELS.large.sha256;
function record(song,threads,extra={}){
 return {...safeFullSongReport({
  model:'large',threadCount:threads,seconds:300,elapsedMs:2200000+10000*threads,
  noteCount:1050,checkpointCount:55,resumed:threads===4,stats:{
   samples:40,peakWorkingSetBytes:5*1024**3,cpuCoreEquivalent:2.5,machineCpuPercent:28
  },audioSha256:hashes[song],notesSha256:'ef'.repeat(32),modelSha256:modelSha
 }),...extra};
}
function q(song,change=0){
 return {audioSha256:hashes[song],currentModelNotesSha256:'ef'.repeat(32),referenceSha256:'01'.repeat(32),
  currentMidiSha256:'02'.repeat(32),baselineMidiSha256:'03'.repeat(32),
  baseline:{truePositive:95,falsePositive:5,falseNegative:5},
  current:{truePositive:95+change,falsePositive:5-change,falseNegative:5-change},
  onsetMeanAbsoluteMs:30,offsetMeanAbsoluteMs:55};
}
const review={ownPlaybackReviewed:true,velocityPedalReviewed:true,
 deviceResponsive:true,checkpointBoundaryChecked:true};
const records=()=>[0,1].flatMap(song=>[2,4,6].map(t=>record(song,t)));
test('5PB rejects CI-only source build, synthetic 4min fixture and missing actual Large records',()=>{
 const report=audit5PB([],[],null);
 assert.equal(report.status,'HOLD');assert.equal(report.releaseApproved,false);
 assert.match(report.blockers.join(';'),/2 bản ghi/);
 const old=safeFullSongReport({model:'large',threadCount:4,seconds:300,
  elapsedMs:250000,noteCount:300,checkpointCount:0,resumed:false,stats:null});
 assert.equal(validRun(old),false);
 assert.equal(audit5PB([old],[],review).validNativeRuns,0);
});
test('5PB enforces 2 different real songs and 2/4/6 real measurements',()=>{
 const insufficient=[record(0,2),record(0,4),record(0,6)];
 const result=audit5PB(insufficient,[q(0)],review);
 assert.equal(result.status,'HOLD');
 assert.match(result.blockers.join(';'),/2 bản ghi/);
 const lacking=audit5PB([...insufficient,record(1,2)],[q(0),q(1)],review);
 assert.match(lacking.blockers.join(';'),/Large 4 luồng/);
 assert.match(lacking.blockers.join(';'),/Large 6 luồng/);
});
test('5PB fails missing observed RAM, model checksum mismatch and nonsense audio fingerprints',()=>{
 let cases=[
  record(0,2,{samples:0}),
  record(0,2,{peakNativeWorkingSetBytes:null}),
  record(0,2,{modelSha256:'0'.repeat(64)}),
  record(0,2,{audioSha256:'not a hash'}),
  record(0,2,{notes:0})
 ];
 for(const r of cases)assert.equal(validRun(r),false);
});
test('5PB reports true model RAM above 12GiB rather than claiming release ready',()=>{
 const reports=records();
 reports[0]={...reports[0],peakNativeWorkingSetBytes:13*1024**3};
 const result=audit5PB(reports,[q(0),q(1)],review);
 assert.equal(result.status,'HOLD');
 assert.match(result.blockers.join(';'),/12 GiB/);
});
test('5PB rejects missing resume proof, missing MIDI reference and F1 >1pp loss',()=>{
 const reports=records().map(x=>({...x,resumed:false}));
 const result=audit5PB(reports,[q(0,-5),q(1)],review);
 assert.equal(result.status,'HOLD');
 assert.match(result.blockers.join(';'),/phục hồi checkpoint/);
 assert.match(result.blockers.join(';'),/F1 giảm quá 1/);
 const missing=audit5PB(records(),[q(0)],review);
 assert.match(missing.blockers.join(';'),/MIDI chuẩn/);
});
test('5PB requires user playback/pedal approval, while never auto approving release',()=>{
 const reports=records();
 const absent=audit5PB(reports,[q(0),q(1)],{...review,velocityPedalReviewed:false});
 assert.equal(absent.status,'HOLD');
 const complete=audit5PB(reports,[q(0),q(1)],review);
 assert.equal(complete.status,'READY_FOR_HUMAN_REVIEW');
 assert.equal(complete.releaseApproved,false);
 assert.equal(complete.sourceCount,2);assert.equal(complete.validNativeRuns,6);
 assert.equal(complete.performance.length,2);
});
test('5PB detects different MIDI note hashes across thread options for manual checking',()=>{
 const reports=records();reports[1]={...reports[1],notesSha256:'bd'.repeat(32)};
 const x=audit5PB(reports,[q(0),q(1)],review);
 assert.match(x.warnings.join(';'),/note hash/);
 assert.equal(x.releaseApproved,false);
});
test('5PB SHA-256 fingerprints are optional for old 5N-E but required for new version 2 reports',()=>{
 const x=safeFullSongReport({
  model:'large',threadCount:4,seconds:300,elapsedMs:500000,noteCount:12,
  checkpointCount:2,resumed:true,stats:{samples:3,peakWorkingSetBytes:2*1024**3,cpuCoreEquivalent:1.4},
  audioSha256:hashes[0],notesSha256:'ef'.repeat(32),modelSha256:modelSha
 });
 assert.equal(x.evidenceVersion,2);assert.equal(validRun(x),true);
 assert.equal(JSON.stringify(x).includes('.wav'),false);
 assert.throws(()=>safeFullSongReport({
  model:'large',threadCount:4,seconds:300,elapsedMs:500000,noteCount:12,
  checkpointCount:2,resumed:true,stats:null,audioSha256:'bad'
 }),/SHA-256/);
});

test('5PB rejects fabricated empty reference note counts instead of treating F1 zero as reliable',()=>{
 const bad=q(0);
 bad.current={truePositive:0,falsePositive:0,falseNegative:0};
 bad.baseline={truePositive:0,falsePositive:0,falseNegative:0};
 const report=audit5PB(records(),[bad,q(1)],review);
 assert.equal(report.status,'HOLD');
 assert.match(report.blockers.join(';'),/MIDI chuẩn/);
});
