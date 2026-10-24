'use strict';
/**
 * Stage 5P-C: release decision gate. Evidence is user-supplied and untrusted;
 * native reports MUST originate from the app-owned report folder, never from
 * renderer IPC input. This produces an auditable readiness packet, not an
 * automatic production release.
 */
const {audit5PB,qualityValid}=require('./acceptance-5pb.cjs');
const HASH=/^[a-f0-9]{64}$/;
const EXPECTED='notiq-5pc-quality-v1';
function validateQualityPacket(candidate){
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
    candidate.schema!==EXPECTED||typeof candidate.samePerformanceConfirmed!=='boolean'||
    candidate.samePerformanceConfirmed!==true)throw Error('Thiếu xác nhận MIDI cùng bản diễn.');
 const fields=['audioSha256','referenceSha256','currentMidiSha256',
   'baselineMidiSha256','currentModelNotesSha256'];
 if(fields.some(k=>typeof candidate[k]!=='string'||!HASH.test(candidate[k])))
  throw Error('Checksum SHA-256 trong MIDI tham chiếu không hợp lệ.');
 if(!qualityValid(candidate,candidate.audioSha256))
  throw Error('Đối chiếu MIDI thiếu TP/FP/FN hoặc sai số nhấn/nhả.');
 const copy={
  audioSha256:candidate.audioSha256,
  referenceSha256:candidate.referenceSha256,
  currentMidiSha256:candidate.currentMidiSha256,
  baselineMidiSha256:candidate.baselineMidiSha256,
  currentModelNotesSha256:candidate.currentModelNotesSha256,
  baseline:{...candidate.baseline},current:{...candidate.current},
  onsetMeanAbsoluteMs:candidate.onsetMeanAbsoluteMs,
  offsetMeanAbsoluteMs:candidate.offsetMeanAbsoluteMs
 };
 return copy;
}
function validateReview(review){
 const flags=['ownPlaybackReviewed','velocityPedalReviewed','deviceResponsive','checkpointBoundaryChecked'];
 if(!review||typeof review!=='object'||Array.isArray(review))return Object.fromEntries(flags.map(k=>[k,false]));
 return Object.fromEntries(flags.map(k=>[k,review[k]===true]));
}
function finalReadiness(reports,files=[],review=null,{sourceBuildPass=false,portableIntegrityPass=false,
  windowsLaunchVerified=false}={}){
 if(!Array.isArray(files)||files.length>8)throw Error('Tối đa 8 báo cáo MIDI chuẩn.');
 const comparisons=[],invalid=[];
 for(let i=0;i<files.length;i++){
  try{comparisons.push(validateQualityPacket(files[i]));}
  catch(error){invalid.push('Báo cáo MIDI #'+(i+1)+': '+String(error?.message||error));}
 }
 const flags=validateReview(review);
 const native=audit5PB(reports,comparisons,flags);
 const blockers=[...native.blockers,...invalid];
 if(!sourceBuildPass)blockers.push('Chưa có bằng chứng Windows CI biên dịch từ mã nguồn.');
 if(!portableIntegrityPass)blockers.push('Chưa có bằng chứng ZIP/ASAR/x64 được đối chiếu checksum.');
 if(!windowsLaunchVerified)blockers.push('Chưa xác nhận ứng dụng mở và xuất MIDI thật trên Windows.');
 const dedup=[...new Set(blockers)];
 return {
  schema:'notiq-5pc-final-readiness-v1',
  status:dedup.length?'HOLD':'READY_FOR_OWNER_REVIEW',
  releaseApproved:false,
  candidateRelease:false,
  qualityPacketsAccepted:comparisons.length,
  qualityPacketsRejected:invalid.length,
  nativeRunsAccepted:native.validNativeRuns,
  independentSongs:native.sourceCount,
  blockers:dedup,warnings:native.warnings,
  review:flags,
  sourceBuildPass:sourceBuildPass===true,
  portableIntegrityPass:portableIntegrityPass===true,
  windowsLaunchVerified:windowsLaunchVerified===true,
  note:'READY_FOR_OWNER_REVIEW is NOT a release authorization. Human owner must review real audio and approve a separate production process.'
 };
}
module.exports={finalReadiness,validateQualityPacket,validateReview};
