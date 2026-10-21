import type {Note} from './audio';
import type {PedalEvent} from './pedal';

/** Each inference retains its own unmodified, validated notes and CC64. */
export type EngineSnapshot={engine:'muscriptor'|'transkun-v2';notes:Note[];pedalEvents:PedalEvent[]};
export type NotePair={muscriptor:Note;transkun:Note;onsetDifferenceMs:number;durationDifferenceMs:number};
export type Comparison={
  muscriptor:EngineSnapshot;
  transkun:EngineSnapshot;
  pairs:NotePair[];
  muscriptorOnly:Note[];
  transkunOnly:Note[];
  meanAbsOnsetDifferenceMs:number;
  meanAbsDurationDifferenceMs:number;
};
export const ONSET_TOLERANCE_SECONDS=0.1; // explicit 100ms, not an accuracy threshold
const validTime=(x:Note)=>Number.isFinite(x.startTimeSeconds)&&x.startTimeSeconds>=0
 && Number.isFinite(x.durationSeconds)&&x.durationSeconds>0
 && Number.isInteger(x.pitchMidi)&&x.pitchMidi>=0&&x.pitchMidi<=127;

export function compareEngines(a:EngineSnapshot,b:EngineSnapshot,tolerance=ONSET_TOLERANCE_SECONDS):Comparison{
 if(a.engine!=='muscriptor'||b.engine!=='transkun-v2')throw Error('Sai thứ tự engine đối chiếu.');
 if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>0.5)throw Error('Ngưỡng thời gian so sánh không hợp lệ.');
 if(a.notes.length>150000||b.notes.length>150000||!a.notes.every(validTime)||!b.notes.every(validTime))
  throw Error('Không thể đối chiếu kết quả MIDI không hợp lệ.');
 const byPitch=new Map<number,Array<{note:Note;index:number}>>();
 b.notes.forEach((note,index)=>{
  const arr=byPitch.get(note.pitchMidi)||[];
  arr.push({note,index});byPitch.set(note.pitchMidi,arr);
 });
 for(const arr of byPitch.values())arr.sort((x,y)=>
  x.note.startTimeSeconds-y.note.startTimeSeconds||x.index-y.index);
 const used=new Set<number>();
 const pairs:NotePair[]=[];
 const muscriptorOnly:Note[]=[];
 const sortedA=[...a.notes].sort((x,y)=>x.startTimeSeconds-y.startTimeSeconds||x.pitchMidi-y.pitchMidi);
 for(const left of sortedA){
  const candidates=byPitch.get(left.pitchMidi)||[];
  // Binary-search the first potentially matching onset. Avoid O(N^2) full-song cross-product.
  let lo=0,hi=candidates.length;
  while(lo<hi){
   const mid=(lo+hi)>>1;
   if(candidates[mid].note.startTimeSeconds<left.startTimeSeconds-tolerance)lo=mid+1;
   else hi=mid;
  }
  let best:{note:Note;index:number}|null=null,bestScore=Infinity;
  for(let j=lo;j<candidates.length;j++){
   const c=candidates[j];
   if(c.note.startTimeSeconds>left.startTimeSeconds+tolerance)break;
   if(used.has(c.index))continue;
   const onsetDelta=Math.abs(c.note.startTimeSeconds-left.startTimeSeconds);
   const durationDelta=Math.abs(c.note.durationSeconds-left.durationSeconds);
   // Onset drives association, then duration resolves duplicate-onset candidates.
   const score=onsetDelta*10+Math.min(durationDelta,10)*0.1;
   if(score<bestScore){best=c;bestScore=score}
  }
  if(!best){muscriptorOnly.push(left);continue}
  used.add(best.index);
  pairs.push({
   muscriptor:left,transkun:best.note,
   onsetDifferenceMs:Math.round((best.note.startTimeSeconds-left.startTimeSeconds)*1000),
   durationDifferenceMs:Math.round((best.note.durationSeconds-left.durationSeconds)*1000),
  });
 }
 const transkunOnly=b.notes.filter((_n,index)=>!used.has(index))
  .sort((x,y)=>x.startTimeSeconds-y.startTimeSeconds||x.pitchMidi-y.pitchMidi);
 const mean=(f:(p:NotePair)=>number)=>pairs.length?
  Math.round(pairs.reduce((sum,p)=>sum+Math.abs(f(p)),0)/pairs.length):0;
 return {
  muscriptor:a,transkun:b,pairs,muscriptorOnly,transkunOnly,
  meanAbsOnsetDifferenceMs:mean(p=>p.onsetDifferenceMs),
  meanAbsDurationDifferenceMs:mean(p=>p.durationDifferenceMs)
 };
}
