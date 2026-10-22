import type {Note} from './audio';
/** Optional, reversible postprocess: mirrors NeuralNote's same instrument+pitch overlap merge.
 * Only true temporal overlaps; adjacent/retriggered notes stay independent.
 * This cannot recover missed or incorrect AI pitches and must not be labeled a model accuracy gain.
 */
export type OverlapCleanup={notes:Note[];merged:number;affectedTracks:number};
export function previewOverlapCleanup(notes:Note[]):OverlapCleanup{
 const grouped=new Map<string,Note[]>();
 const unchanged:Note[]=[];
 for(const note of notes){
  if(!Number.isFinite(note.startTimeSeconds)||!Number.isFinite(note.durationSeconds)||
   note.durationSeconds<=0||note.startTimeSeconds<0||
   !Number.isInteger(note.pitchMidi)||note.pitchMidi<0||note.pitchMidi>127)
    throw Error('Nốt MIDI không hợp lệ, không được tự sửa kết quả AI.');
  if(note.isDrum||note.program===128){unchanged.push({...note});continue}
  const key=String(note.program??'unassigned')+':'+note.pitchMidi;
  const notesForKey=grouped.get(key)||[];
  notesForKey.push({...note});grouped.set(key,notesForKey);
 }
 const result:Note[]=[...unchanged];
 const changedPrograms=new Set<string>();
 let merged=0;
 for(const [key,bucket] of grouped){
  bucket.sort((a,b)=>a.startTimeSeconds-b.startTimeSeconds||
    b.durationSeconds-a.durationSeconds);
  let current:Note|null=null;
  for(const n of bucket){
   if(!current){current=n;continue}
   const currentEnd=current.startTimeSeconds+current.durationSeconds;
   if(n.startTimeSeconds < currentEnd-1e-8){
    current.durationSeconds=Math.max(currentEnd,n.startTimeSeconds+n.durationSeconds)-current.startTimeSeconds;
    current.amplitude=Math.max(current.amplitude,n.amplitude);
    // Any frame-aligned pitch bends become invalid after merging spans.
    current.pitchBends=undefined;
    merged++;
    changedPrograms.add(key.split(':')[0]);
   }else{result.push(current);current=n}
  }
  if(current)result.push(current);
 }
 result.sort((a,b)=>a.startTimeSeconds-b.startTimeSeconds||
  (a.program??-1)-(b.program??-1)||a.pitchMidi-b.pitchMidi);
 return {notes:result,merged,affectedTracks:changedPrograms.size};
}
