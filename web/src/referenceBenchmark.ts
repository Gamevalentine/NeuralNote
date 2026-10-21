import * as MidiPackage from '@tonejs/midi';
const Midi= MidiPackage.Midi || (MidiPackage as unknown as {default:{Midi:typeof MidiPackage.Midi}}).default.Midi;
import type {Note} from './audio';
import type {Comparison} from './compareEngines';

export type MusicMode='piano'|'ensemble'|'guided';
export type ReferenceNote={pitchMidi:number;startTimeSeconds:number;durationSeconds:number;program:number};
export type MidiReference={fileName:string;notes:ReferenceNote[];durationSeconds:number;tracks:number};
export type NoteScore={
 truePositive:number;falsePositive:number;falseNegative:number;
 precision:number;recall:number;f1:number;onsetMeanAbsoluteMs:number;
 offsetWithinTolerance:number;matchedOffsetMeanAbsoluteMs:number;
};
export type BenchmarkResult={muscriptor:NoteScore;transkun:NoteScore;recommended:'muscriptor'|'transkun-v2'|null;mode:MusicMode;offsetSeconds:number;referenceCount:number;};
export const BENCHMARK_ONSET_TOLERANCE=0.1; // absolute +/-100ms
export const BENCHMARK_OFFSET_MIN_TOLERANCE=0.1; // end time +/-100ms or 20% reference duration, whichever larger

export async function readReferenceMidi(file:Blob,fileName:string):Promise<MidiReference>{
 if(!/\.midi?$/i.test(fileName)||file.size<14||file.size>3*1024*1024)
  throw Error('Tệp tham chiếu phải là .mid/.midi hợp lệ, dung lượng tối đa 3 MB.');
 const midi=new Midi(new Uint8Array(await file.arrayBuffer()));
 const tracks=midi.tracks.filter(t=>!t.instrument.percussion);
 const notes:ReferenceNote[]=[];
 for(const track of tracks){
  for(const note of track.notes){
   const pitchMidi=note.midi,startTimeSeconds=note.time,durationSeconds=note.duration;
   if(!Number.isInteger(pitchMidi)||pitchMidi<0||pitchMidi>127||
      !Number.isFinite(startTimeSeconds)||startTimeSeconds<0||startTimeSeconds>900||
      !Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>900)
      throw Error('MIDI tham chiếu chứa thời gian/nốt bất thường hoặc quá 15 phút.');
   notes.push({pitchMidi,startTimeSeconds,durationSeconds,program:track.instrument.number});
   if(notes.length>150000)throw Error('MIDI tham chiếu vượt 150.000 nốt.');
  }
 }
 if(!notes.length)throw Error('MIDI tham chiếu không có nốt giai điệu để đối chiếu.');
 const durationSeconds=notes.reduce((end,n)=>Math.max(end,n.startTimeSeconds+n.durationSeconds),0);
 if(durationSeconds>910)throw Error('MIDI tham chiếu dài hơn 15 phút.');
 return {fileName,notes:notes.sort((a,b)=>a.startTimeSeconds-b.startTimeSeconds),durationSeconds,tracks:tracks.length};
}
const percent=(a:number,b:number):number=>b===0?0:a/b;
const rounded=(x:number):number=>Math.round(x*10000)/10000;
const validCandidate=(n:Note)=>Number.isInteger(n.pitchMidi)&&n.pitchMidi>=0&&n.pitchMidi<=127&&
 Number.isFinite(n.startTimeSeconds)&&n.startTimeSeconds>=0&&n.startTimeSeconds<=910&&
 Number.isFinite(n.durationSeconds)&&n.durationSeconds>0&&n.durationSeconds<=900;
function chosenCandidates(all:Note[],mode:MusicMode):Note[]{
 // Piano-only checks piano-category GM programs from MuScriptor; Transkun itself only emits program 0.
 return mode==='piano' ? all.filter(n=>n.program===undefined||n.program>=0&&n.program<8) : all;
}
/** Precision/Recall versus user-provided true MIDI, not the two-engine agreement.
 * Exact MIDI pitch, and absolute onset <=100ms; one prediction cannot match two labels.
 * End-time error is reported separately and does not turn a pitch/onset match into a false positive.
 */
export function scoreAgainstReference(reference:ReferenceNote[],predictions:Note[],offsetSeconds=0):NoteScore{
 if(!Number.isFinite(offsetSeconds)||Math.abs(offsetSeconds)>5)
  throw Error('Độ dịch MIDI chỉ hỗ trợ từ -5 tới +5 giây.');
 if(reference.length>150000||predictions.length>150000||predictions.some(n=>!validCandidate(n)))
  throw Error('Dữ liệu MIDI đánh giá không hợp lệ.');
 const byPitch=new Map<number,{n:Note;index:number}[]>();
 predictions.forEach((n,index)=>{
  const bucket=byPitch.get(n.pitchMidi)||[];
  bucket.push({n,index});byPitch.set(n.pitchMidi,bucket);
 });
 for(const items of byPitch.values())items.sort((a,b)=>a.n.startTimeSeconds-b.n.startTimeSeconds||a.index-b.index);
 const used=new Set<number>();
 let totalOnset=0,totalOffset=0,offsetWithinTolerance=0;
 for(const ref of [...reference].sort((a,b)=>a.startTimeSeconds-b.startTimeSeconds)){
  const onset=ref.startTimeSeconds+offsetSeconds;
  const bucket=byPitch.get(ref.pitchMidi)||[];
  let lo=0,hi=bucket.length;
  while(lo<hi){
   const mid=(lo+hi)>>1;
   if(bucket[mid].n.startTimeSeconds<onset-BENCHMARK_ONSET_TOLERANCE)lo=mid+1;else hi=mid;
  }
  let best:{n:Note;index:number}|undefined,delta=Infinity;
  for(let j=lo;j<bucket.length;j++){
   const candidate=bucket[j];
   if(candidate.n.startTimeSeconds>onset+BENCHMARK_ONSET_TOLERANCE)break;
   if(used.has(candidate.index))continue;
   const d=Math.abs(candidate.n.startTimeSeconds-onset);
   if(d<delta){delta=d;best=candidate}
  }
  if(!best)continue;
  used.add(best.index);
  totalOnset+=delta*1000;
  const endError=Math.abs((best.n.startTimeSeconds+best.n.durationSeconds)-
    (ref.startTimeSeconds+ref.durationSeconds+offsetSeconds));
  totalOffset+=endError*1000;
  if(endError<=Math.max(BENCHMARK_OFFSET_MIN_TOLERANCE,ref.durationSeconds*0.2))
   offsetWithinTolerance++;
 }
 const tp=used.size,fp=predictions.length-tp,fn=reference.length-tp;
 const precision=percent(tp,tp+fp),recall=percent(tp,tp+fn);
 const f1=precision+recall?2*precision*recall/(precision+recall):0;
 return {truePositive:tp,falsePositive:fp,falseNegative:fn,
  precision:rounded(precision),recall:rounded(recall),f1:rounded(f1),
  onsetMeanAbsoluteMs:tp?Math.round(totalOnset/tp):0,
  offsetWithinTolerance,
  matchedOffsetMeanAbsoluteMs:tp?Math.round(totalOffset/tp):0};
}
export function benchmarkComparison(result:Comparison,reference:MidiReference,mode:MusicMode,offsetSeconds=0):BenchmarkResult{
 if(!['piano','ensemble','guided'].includes(mode))throw Error('Chế độ nhạc không hợp lệ.');
 // Guided evaluation scores full reference. In auto recommendation, no classification of the audio is claimed.
 const effectiveMode=mode==='guided'?'ensemble':mode;
 const ref=effectiveMode==='piano'?reference.notes.filter(n=>n.program>=0&&n.program<8):reference.notes;
 if(!ref.length)throw Error('MIDI tham chiếu không có track Piano GM0–7 trong chế độ Piano.');
 const left=scoreAgainstReference(ref,chosenCandidates(result.muscriptor.notes,effectiveMode),offsetSeconds);
 const right=scoreAgainstReference(ref,chosenCandidates(result.transkun.notes,effectiveMode),offsetSeconds);
 // Only recommend with reference evidence, and only a meaningful >2-point F1 difference.
 const difference=left.f1-right.f1;
 const recommended=Math.abs(difference)<0.02?null:difference>0?'muscriptor':'transkun-v2';
 return {muscriptor:left,transkun:right,recommended,mode,offsetSeconds,referenceCount:ref.length};
}
