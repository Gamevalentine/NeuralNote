import {convertAudioToNativeWav} from './muscriptorNative';
import {toPianoNotes} from './muscriptorProtocol';
import {toPianoV2Notes} from './transkunProtocol';
import {compareEngines,type Comparison} from './compareEngines';

/** Native-only dual inference with identical PCM; leaves current Piano Roll untouched. */
export async function compareOriginalAudio(
 audio:Blob, onStatus:(s:string)=>void
):Promise<Comparison>{
 const native=window.notiqNative;
 if(!native?.transcribe || !native?.transcribePiano)
  throw Error('Cần bản NOTIQ Windows có cả hai engine.');
 onStatus('Chuẩn bị PCM 16 kHz dùng chung cho hai AI');
 const wav=await convertAudioToNativeWav(audio,p=>onStatus('Đang chuẩn bị âm thanh '+p+'%'));
 onStatus('1/2: MuScriptor đang nhận diện…');
 const first=toPianoNotes(await native.transcribe(wav));
 onStatus('2/2: Transkun V2 đang nhận diện Piano…');
 const second=toPianoV2Notes(await native.transcribePiano(wav));
 return compareEngines(
  {engine:'muscriptor',notes:first,pedalEvents:[]},
  {engine:'transkun-v2',notes:second.notes,pedalEvents:second.pedalEvents}
 );
}
