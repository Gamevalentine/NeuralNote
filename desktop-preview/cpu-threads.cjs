'use strict';
const {createHash}=require('node:crypto');
const THREAD_CHOICES=Object.freeze([2,4,6]);
function cpuThreadCount(value){
 if(!Number.isInteger(value)||!THREAD_CHOICES.includes(value))
  throw Error('CPU chỉ hỗ trợ 2, 4 hoặc 6 luồng.');
 return value;
}
function fingerprintPCM(wav){
 const bytes=wav instanceof Uint8Array?wav:new Uint8Array(wav);
 return createHash('sha256').update(bytes).digest('hex');
}
function sameBenchmarkClip(a,b){
 return a?.model===b?.model && a?.clipSeconds===b?.clipSeconds &&
  a?.startSeconds===b?.startSeconds && a?.pcmSha256===b?.pcmSha256 &&
  typeof a.pcmSha256==='string' && /^[a-f0-9]{64}$/.test(a.pcmSha256);
}
module.exports={THREAD_CHOICES,cpuThreadCount,fingerprintPCM,sameBenchmarkClip};
