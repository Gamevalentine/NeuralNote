'use strict';
const SAMPLE_RATE=16000,HEADER=44;
function makeClip(source,durationSeconds,startSeconds=0){
 const data=source instanceof Uint8Array?source:new Uint8Array(source);
 const dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
 if(data.byteLength<HEADER||!Number.isFinite(durationSeconds)||![20,30,60].includes(durationSeconds)||
   !Number.isFinite(startSeconds)||startSeconds<0||startSeconds>900 ||
   String.fromCharCode(...data.subarray(0,4))!=='RIFF' ||
   String.fromCharCode(...data.subarray(8,12))!=='WAVE'||
   String.fromCharCode(...data.subarray(36,40))!=='data'||
   dv.getUint16(20,true)!==3||dv.getUint16(22,true)!==1||
   dv.getUint32(24,true)!==SAMPLE_RATE||dv.getUint16(32,true)!==4||
   dv.getUint16(34,true)!==32)throw Error('Benchmark chỉ hỗ trợ WAV Float32 mono 16 kHz chuẩn hóa.');
 const frames=dv.getUint32(40,true)/4;
 if(!Number.isInteger(frames)||frames<1||HEADER+frames*4!==data.byteLength)
  throw Error('WAV có kích thước không hợp lệ.');
 const offsetFrames=Math.round(startSeconds*SAMPLE_RATE);
 const clipFrames=durationSeconds*SAMPLE_RATE;
 if(offsetFrames+clipFrames>frames)
  throw Error('Đoạn thử vượt quá thời lượng file. Hãy giảm vị trí bắt đầu hoặc chọn đoạn ngắn.');
 const result=new Uint8Array(HEADER+clipFrames*4);
 result.set(data.subarray(0,HEADER));result.set(data.subarray(HEADER+offsetFrames*4,HEADER+(offsetFrames+clipFrames)*4),HEADER);
 const out=new DataView(result.buffer);
 out.setUint32(4,result.byteLength-8,true);out.setUint32(40,clipFrames*4,true);
 return result;
}
module.exports={makeClip};
