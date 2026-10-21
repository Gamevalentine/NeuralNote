import type {Note} from './audio';
import type {PedalEvent} from './pedal.ts';
export type PianoV2Result={
 schema:1;
 engine:'transkun-v2';
 notes:Array<{
   pitchMidi:number;startTimeSeconds:number;durationSeconds:number;
   amplitude:number;program:0;isDrum:false;
 }>;
 pedalEvents:PedalEvent[];
};
export function isPianoV2Result(payload:unknown):payload is PianoV2Result{
 if(!payload||typeof payload!=='object')return false;
 const result=payload as Record<string,unknown>;
 if(result.schema!==1||result.engine!=='transkun-v2'
   ||!Array.isArray(result.notes)||!Array.isArray(result.pedalEvents)
   ||result.notes.length>150000||result.pedalEvents.length>30000)return false;
 const validNote=(value:unknown):boolean=>{
   if(!value||typeof value!=='object')return false;
   const x=value as Record<string,unknown>;
   return Number.isInteger(x.pitchMidi)&&Number(x.pitchMidi)>=0&&Number(x.pitchMidi)<=127
     &&typeof x.startTimeSeconds==='number'&&Number.isFinite(x.startTimeSeconds)&&x.startTimeSeconds>=0&&x.startTimeSeconds<=910
     &&typeof x.durationSeconds==='number'&&Number.isFinite(x.durationSeconds)&&x.durationSeconds>0&&x.durationSeconds<=900
     &&typeof x.amplitude==='number'&&Number.isFinite(x.amplitude)&&x.amplitude>=0&&x.amplitude<=1
     &&x.program===0&&x.isDrum===false;
 };
 const validPedal=(value:unknown):boolean=>{
  if(!value||typeof value!=='object')return false;
  const x=value as Record<string,unknown>;
  return x.trackKey==='gm-0'&&typeof x.timeSeconds==='number'&&Number.isFinite(x.timeSeconds)
   &&x.timeSeconds>=0&&x.timeSeconds<=910&&(x.value===0||x.value===127);
 };
 return result.notes.every(validNote)&&result.pedalEvents.every(validPedal);
}
export function toPianoV2Notes(payload:unknown):{notes:Note[];pedalEvents:PedalEvent[]}{
 if(!isPianoV2Result(payload))throw Error('Kết quả Transkun V2 không hợp lệ, không thay thế MIDI hiện có.');
 return {
  notes:payload.notes.map(n=>({
   pitchMidi:n.pitchMidi,startTimeSeconds:n.startTimeSeconds,
   durationSeconds:n.durationSeconds,amplitude:n.amplitude,program:0,isDrum:false
  })),
  pedalEvents:payload.pedalEvents.map(p=>({...p}))
 };
}
