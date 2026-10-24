'use strict';
// Stage 5P-B: analyze EVIDENCE, never substitute fixtures for real music.
// A passing evidence inventory NEVER approves a release without human review.
const {MODELS}=require('./models.cjs');
const HASH=/^[a-f0-9]{64}$/;
const GiB=1024**3;
const sha=x=>typeof x==='string'&&HASH.test(x);
function f1(score){
 if(!score||typeof score!=='object')return null;
 const {truePositive:tp,falsePositive:fp,falseNegative:fn}=score;
 if(![tp,fp,fn].every(x=>Number.isInteger(x)&&x>=0))return null;
 const total=2*tp+fp+fn;
 return total?2*tp/total:0;
}
function validRun(r){
 return r&&r.schema==='notiq-5ne-fullsong-v1'&&r.evidenceVersion===2&&
 r.model==='large'&&r.modelSha256===MODELS.large.sha256&&
 [2,4,6].includes(r.threads)&&Number.isFinite(r.songSeconds)&&
 r.songSeconds>=240&&r.songSeconds<=360&&sha(r.audioSha256)&&sha(r.notesSha256)&&
 r.fullSongNativeMeasured===true&&Number.isFinite(r.totalElapsedMs)&&r.totalElapsedMs>0&&
 Number.isInteger(r.notes)&&r.notes>0&&Number.isInteger(r.checkpointCount)&&r.checkpointCount>=0&&
 typeof r.resumed==='boolean'&&Number.isInteger(r.samples)&&r.samples>=2&&
 Number.isFinite(r.peakNativeWorkingSetBytes)&&r.peakNativeWorkingSetBytes>0&&
 Number.isFinite(r.cpuCoreEquivalent)&&r.cpuCoreEquivalent>=0;
}
function qualityValid(q,sourceHash){
 if(!q||q.audioSha256!==sourceHash||!sha(q.currentModelNotesSha256)||!sha(q.referenceSha256)||
    !sha(q.currentMidiSha256)||!sha(q.baselineMidiSha256))return false;
 if(!Number.isFinite(q.onsetMeanAbsoluteMs)||q.onsetMeanAbsoluteMs<0||
    !Number.isFinite(q.offsetMeanAbsoluteMs)||q.offsetMeanAbsoluteMs<0)return false;
 const current=f1(q.current),baseline=f1(q.baseline);
 return current!==null&&baseline!==null;
}
function audit5PB(reports,comparisons,review){
 if(!Array.isArray(reports)||reports.length>80||
    !Array.isArray(comparisons)||comparisons.length>20)
   throw Error('Hồ sơ nghiệm thu 5P-B không hợp lệ.');
 const blockers=[],warnings=[];
 const good=reports.filter(validRun);
 if(good.length!==reports.length)blockers.push('Có báo cáo thiếu bằng chứng suy luận Large thật / RAM / SHA256 / số nốt.');
 const bySong=new Map();
 for(const report of good){
  const list=bySong.get(report.audioSha256)||[];
  list.push(report);bySong.set(report.audioSha256,list);
 }
 if(bySong.size<2)blockers.push('Cần tối thiểu 2 bản ghi âm thật khác nhau, mỗi bài dài 4–6 phút.');
 for(const [hash,runs] of bySong){
  for(const n of [2,4,6]){
   if(!runs.some(r=>r.threads===n))
    blockers.push('Chưa đo Large '+n+' luồng cho bản ghi '+hash.slice(0,10)+'.');
  }
  if(new Set(runs.map(r=>r.notesSha256)).size>1)
   warnings.push('Kết quả note hash khác giữa các lượt chạy: '+hash.slice(0,10)+'. Cần đối chiếu các nốt.');
  if(runs.some(r=>r.peakNativeWorkingSetBytes>=12*GiB))
   blockers.push('Native RAM chạm ngưỡng cảnh báo 12 GiB trên bài '+hash.slice(0,10)+'.');
 }
 if(good.length && !good.some(r=>r.resumed===true&&r.checkpointCount>0))
  blockers.push('Chưa có bằng chứng phục hồi checkpoint thật sau khi tạm dừng.');
 for(const hash of bySong.keys()){
  const matched=comparisons.filter(c=>c.audioSha256===hash);
  if(!matched.some(q=>qualityValid(q,hash)&&bySong.get(hash).some(r=>r.notesSha256===q.currentModelNotesSha256))){
   blockers.push('Chưa có đối chiếu MIDI chuẩn hợp lệ cho '+hash.slice(0,10)+'.');continue;
  }
  for(const q of matched.filter(q=>qualityValid(q,hash)&&bySong.get(hash).some(r=>r.notesSha256===q.currentModelNotesSha256))){
   const delta=(f1(q.current)-f1(q.baseline))*100;
   if(delta< -1-1e-9)blockers.push('F1 giảm quá 1 điểm phần trăm ở '+hash.slice(0,10)+'.');
   if(q.onsetMeanAbsoluteMs>100||q.offsetMeanAbsoluteMs>180)
    warnings.push('Sai số nhấn/nhả cần kiểm tra nghe lại ở '+hash.slice(0,10)+'.');
  }
 }
 if(!review||review.ownPlaybackReviewed!==true||review.velocityPedalReviewed!==true||
    review.deviceResponsive!==true||review.checkpointBoundaryChecked!==true)
  blockers.push('Thiếu đánh giá trực tiếp từ người nghe và xác nhận máy 16GB vẫn hoạt động ổn định.');
 // Even a complete set is evidence submitted for *review*, not independent
 // reproduction or an automatic production approval.
 return{
  schema:'notiq-5pb-evidence-review-v1',
  status:blockers.length?'HOLD':'READY_FOR_HUMAN_REVIEW',
  releaseApproved:false,
  sourceCount:bySong.size,
  validNativeRuns:good.length,
  blockers,warnings,
  performance:[...bySong].map(([audioSha256,runs])=>({
   audioSha256,
   measurements:runs.map(r=>({
    threads:r.threads,seconds:Math.round(r.totalElapsedMs/1000),
    peakNativeGiB:Math.round(r.peakNativeWorkingSetBytes/GiB*100)/100,
    notes:r.notes,checkpointCount:r.checkpointCount,resumed:r.resumed
   }))
  })),
  disclaimer:'Không phải kiểm chứng độc lập bản thu, bản MIDI hoặc chất lượng tiếng đàn. Phê duyệt phát hành phải được xác nhận thủ công.'
 };
}
module.exports={audit5PB,validRun,qualityValid,f1};
