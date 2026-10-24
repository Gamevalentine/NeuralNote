'use strict';
// 5N-E: Diagnostics only. Never synthesize a percent or infer GPU/AI accuracy.
const GiB=1024**3;
function finitePositive(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0;}
function songSecondsFromWav(bytes){
 const raw=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(raw.byteLength<44)return null;
 const d=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 const tag=(i)=>String.fromCharCode(...raw.subarray(i,i+4));
 if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(36)!=='data'||
    d.getUint16(20,true)!==3||d.getUint16(22,true)!==1||
    d.getUint32(24,true)!==16000||d.getUint16(34,true)!==32||
    d.getUint16(32,true)!==4)return null;
 const dataBytes=d.getUint32(40,true);
 if(dataBytes+44!==raw.length||dataBytes%4!==0)return null;
 return dataBytes/(16000*4);
}
function heartbeatInfo({nowMs,startedMs,lastProgressMs,percent,snapshot}){
 const elapsed=Math.max(0,Math.floor((nowMs-startedMs)/1000));
 const idle=Math.max(0,Math.floor((nowMs-lastProgressMs)/1000));
 const percentShown=Number.isFinite(percent)?Math.max(0,Math.min(100,Math.floor(percent))):0;
 const measured=snapshot && snapshot.samples>=1 && finitePositive(snapshot.lastWorkingSetBytes);
 const ram=measured?(snapshot.lastWorkingSetBytes/GiB).toFixed(2)+' GiB':'chưa đo được';
 const peak=measured&&finitePositive(snapshot.peakWorkingSetBytes)
   ?(snapshot.peakWorkingSetBytes/GiB).toFixed(2)+' GiB':'chưa đo được';
 const cpu=snapshot && snapshot.samples>=2&&finitePositive(snapshot.cpuCoreEquivalent)
  ?snapshot.cpuCoreEquivalent.toFixed(2)+' lõi':'chưa đo được';
 let state='working';
 if(idle>=180)state='no-progress';
 else if(idle>=90)state='slow';
 const attention=measured && snapshot.peakWorkingSetBytes>=12*GiB
  ?' RAM tiến trình rất cao trên máy 16 GB; cân nhắc Dừng, dùng Small hoặc ít luồng hơn.':'';
 const message=state==='working'
 ?'MuScriptor đang hoạt động; tiến độ xác nhận '+percentShown+'%, tổng '+elapsed+
  ' giây, cập nhật cuối '+idle+' giây. RAM hiện '+ram+', đỉnh '+peak+', CPU '+cpu+'.'+attention
 : 'Chưa có cập nhật tiến độ từ engine '+idle+' giây ('+percentShown+'% thực, tổng '+elapsed+
  ' giây). RAM '+ram+', đỉnh '+peak+', CPU '+cpu+'.'+
  (state==='no-progress'
   ?' Chưa thể kết luận treo. Nếu CPU không hoạt động, bạn có thể bấm Dừng AI và dùng checkpoint để tiếp tục.'
   :' Model Large có thể đang tính toán; chỉ chờ tín hiệu thật, không tăng phần trăm giả.')+attention;
 return{state,elapsedSeconds:elapsed,secondsWithoutProgress:idle,percent:percentShown,
  ramBytes:measured?snapshot.lastWorkingSetBytes:null,
  peakWorkingSetBytes:measured?snapshot.peakWorkingSetBytes:null,
  cpuCoreEquivalent:snapshot?.samples>=2?snapshot.cpuCoreEquivalent:null,
  message};
}
function safeFullSongReport({model,threadCount,seconds,elapsedMs,noteCount,checkpointCount,resumed,stats,
 audioSha256=null,notesSha256=null,modelSha256=null}){
 if(!['small','large'].includes(model)||![2,4,6].includes(threadCount)||
    !finitePositive(seconds)||seconds<1||seconds>900||
    !finitePositive(elapsedMs)||!Number.isInteger(noteCount)||noteCount<0||
    !Number.isInteger(checkpointCount)||checkpointCount<0||typeof resumed!=='boolean')
  throw Error('Thông số báo cáo toàn bài không hợp lệ.');
 const shaValid=x=>x===null || (typeof x==='string'&&/^[a-f0-9]{64}$/.test(x));
 if(!shaValid(audioSha256)||!shaValid(notesSha256)||!shaValid(modelSha256))
   throw Error('SHA-256 báo cáo phải là checksum thực, không có đường dẫn/tên bản thu.');
 return{schema:'notiq-5ne-fullsong-v1',model,threads:threadCount,songSeconds:Math.round(seconds*100)/100,
  evidenceVersion:audioSha256&&notesSha256&&modelSha256?2:1,
  audioSha256,notesSha256,modelSha256,
  totalElapsedMs:Math.round(elapsedMs),notes:noteCount,checkpointCount,resumed,
  samples:stats?.samples||0,peakNativeWorkingSetBytes:stats?.peakWorkingSetBytes??null,
  cpuCoreEquivalent:stats?.cpuCoreEquivalent??null,
  machineCpuPercent:stats?.machineCpuPercent??null,
  // Never label missing measurements as PASS.
  fullSongNativeMeasured:true,
  disclaimer:'Số liệu tại máy chạy. Không đo được F1, velocity hay chất lượng pedal từ thời gian và RAM.'};
}
module.exports={songSecondsFromWav,heartbeatInfo,safeFullSongReport};
