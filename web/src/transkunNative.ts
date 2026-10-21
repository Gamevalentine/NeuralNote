import {convertAudioToNativeWav,type NativeProgress} from './muscriptorNative';
import {toPianoV2Notes} from './transkunProtocol';
import type {Note} from './audio';
import type {PedalEvent} from './pedal.ts';
export async function runPianoV2(
 source:Blob,onProgress:(progress:NativeProgress)=>void
):Promise<{notes:Note[];pedalEvents:PedalEvent[]}>{
 const bridge=window.notiqNative;
 if(!bridge?.transcribePiano)throw Error('Transkun V2 chỉ hỗ trợ trong bản NOTIQ Windows có engine Piano riêng.');
 const detach=bridge.onProgress(onProgress);
 try{
   onProgress({kind:'transcribe',percent:1,message:'Chuẩn bị WAV cho Transkun V2 Piano…'});
   const wav=await convertAudioToNativeWav(source,percent=>onProgress({
     kind:'transcribe',percent:Math.min(2,Math.round(percent*.02)),
     message:'Chuẩn bị bài nhạc Piano: '+percent+'%'
   }));
   onProgress({kind:'transcribe',percent:2,message:'Chuyển âm thanh sang Transkun V2 CPU…'});
   const response=await bridge.transcribePiano(wav);
   return toPianoV2Notes(response);
 }finally{detach()}
}
