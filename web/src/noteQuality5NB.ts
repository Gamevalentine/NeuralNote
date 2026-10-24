import type {Note} from './audio';
import type {ReferenceNote, NoteScore} from './referenceBenchmark';

/** 5N-B: extremely conservative candidate cleanup, OFF unless the user clicks it.
 * It never guesses missing notes, never shifts onsets/offsets, and never
 * treats a repeated note tens of milliseconds later as a duplicate.
 */
export type DuplicateReview = {
  notes: Note[];
  removed: number;
  examples: {timeSeconds:number;pitchMidi:number;program:number|null}[];
};

export function previewNearExactDuplicates(notes: readonly Note[]): DuplicateReview {
  if(notes.length>150000) throw Error('Quá nhiều nốt MIDI để kiểm tra.');
  const groups=new Map<string,{index:number;note:Note}[]>();
  for(let index=0; index<notes.length; index++){
    const n=notes[index];
    if(!Number.isFinite(n.startTimeSeconds)||n.startTimeSeconds<0||
      !Number.isFinite(n.durationSeconds)||n.durationSeconds<=0||
      !Number.isInteger(n.pitchMidi)||n.pitchMidi<0||n.pitchMidi>127)
      throw Error('Nốt không hợp lệ; không thể tự động lọc.');
    if(n.isDrum||n.program===128||(n.pitchBends?.length||0)>0)continue;
    const key=String(n.program??'none')+':'+n.pitchMidi;
    const bucket=groups.get(key)||[];
    bucket.push({index,note:n});groups.set(key,bucket);
  }
  const removed=new Set<number>();
  const examples:DuplicateReview['examples']=[];
  for(const bucket of groups.values()){
    bucket.sort((a,b)=>a.note.startTimeSeconds-b.note.startTimeSeconds||a.index-b.index);
    const recent:typeof bucket=[];
    for(const item of bucket){
      const n=item.note,t=n.startTimeSeconds,end=t+n.durationSeconds;
      while(recent.length&&t-recent[0].note.startTimeSeconds>0.012)recent.shift();
      const duplicate=recent.some(p=>{
        const prev=p.note;
        return Math.abs(t-prev.startTimeSeconds)<=0.012+1e-9 &&
          Math.abs(end-(prev.startTimeSeconds+prev.durationSeconds))<=0.025+1e-9 &&
          Number.isFinite(n.amplitude)&&Number.isFinite(prev.amplitude)&&
          Math.abs(n.amplitude-prev.amplitude)<=0.06;
      });
      if(duplicate){
        removed.add(item.index);
        if(examples.length<8) examples.push({timeSeconds:t,pitchMidi:n.pitchMidi,program:n.program??null});
      }else{
        recent.push(item);
        // Capped work even on pathological simultaneous overlapping note lists.
        if(recent.length>12)recent.shift();
      }
    }
  }
  return {notes:notes.filter((_,i)=>!removed.has(i)),removed:removed.size,examples};
}

type Example={timeSeconds:number;pitchMidi:number;program?:number;errorMs?:number};
export type ReferenceDiagnosis={
  matched:number;missing:number;extra:number;offsetWarnings:number;
  missingExamples:Example[];extraExamples:Example[];offsetExamples:Example[];
};

/** Follows NOTIQ 5I matching: exact pitch, onset within 100ms, 1-to-1.
 * Reference MIDI is independently user supplied: this report is not AI ground truth.
 */
export function diagnoseAgainstReference(
  reference:readonly ReferenceNote[], predicted:readonly Note[], offsetSeconds=0
):ReferenceDiagnosis{
  if(!Number.isFinite(offsetSeconds)||Math.abs(offsetSeconds)>5||
    reference.length>150000||predicted.length>150000)
    throw Error('Dữ liệu so sánh vượt giới hạn.');
  const byPitch=new Map<number,{note:Note;index:number}[]>();
  predicted.forEach((note,index)=>{
    if(!Number.isFinite(note.startTimeSeconds)||note.startTimeSeconds<0||
       !Number.isFinite(note.durationSeconds)||note.durationSeconds<=0||
       !Number.isInteger(note.pitchMidi)||note.pitchMidi<0||note.pitchMidi>127)
       throw Error('Dữ liệu dự đoán không hợp lệ.');
    const bucket=byPitch.get(note.pitchMidi)||[];
    bucket.push({note,index});byPitch.set(note.pitchMidi,bucket);
  });
  for(const bucket of byPitch.values())bucket.sort((a,b)=>
    a.note.startTimeSeconds-b.note.startTimeSeconds||a.index-b.index);
  const used=new Set<number>();
  const missingExamples:Example[]=[],extraExamples:Example[]=[],offsetExamples:Example[]=[];
  let missing=0,offsetWarnings=0;
  for(const ref of [...reference].sort((a,b)=>a.startTimeSeconds-b.startTimeSeconds)){
    if(!Number.isFinite(ref.startTimeSeconds)||ref.startTimeSeconds<0||
       !Number.isFinite(ref.durationSeconds)||ref.durationSeconds<=0||
       !Number.isInteger(ref.pitchMidi)||ref.pitchMidi<0||ref.pitchMidi>127)
       throw Error('MIDI chuẩn không hợp lệ.');
    const onset=ref.startTimeSeconds+offsetSeconds;
    const bucket=byPitch.get(ref.pitchMidi)||[];
    let lo=0,hi=bucket.length;
    while(lo<hi){const mid=(lo+hi)>>>1;
      if(bucket[mid].note.startTimeSeconds<onset-.1)lo=mid+1;else hi=mid;}
    let chosen:typeof bucket[number]|undefined,delta=Infinity;
    for(let j=lo;j<bucket.length;j++){
      const c=bucket[j];
      if(c.note.startTimeSeconds>onset+.1)break;
      if(used.has(c.index))continue;
      const d=Math.abs(c.note.startTimeSeconds-onset);
      if(d<delta){delta=d;chosen=c;}
    }
    if(!chosen){
      missing++;
      if(missingExamples.length<8)
        missingExamples.push({timeSeconds:onset,pitchMidi:ref.pitchMidi,program:ref.program});
      continue;
    }
    used.add(chosen.index);
    const offsetError=Math.abs((chosen.note.startTimeSeconds+chosen.note.durationSeconds)-
       (onset+ref.durationSeconds));
    if(offsetError>Math.max(.1,ref.durationSeconds*.2)){
      offsetWarnings++;
      if(offsetExamples.length<8)
        offsetExamples.push({timeSeconds:chosen.note.startTimeSeconds,
          pitchMidi:ref.pitchMidi,program:ref.program,errorMs:Math.round(offsetError*1000)});
    }
  }
  predicted.forEach((note,i)=>{
    if(!used.has(i)&&extraExamples.length<8)
      extraExamples.push({timeSeconds:note.startTimeSeconds,pitchMidi:note.pitchMidi,program:note.program});
  });
  return {matched:used.size,missing,extra:predicted.length-used.size,
    offsetWarnings,missingExamples,extraExamples,offsetExamples};
}

/** Prevent any known reference regression, even if rounded F1 is unchanged. */
export function cleanupPreservesReference(before:NoteScore,after:NoteScore):boolean{
  const rawF1=(s:NoteScore)=>{
    const total=2*s.truePositive+s.falsePositive+s.falseNegative;
    return total?2*s.truePositive/total:0;
  };
  return after.truePositive>=before.truePositive &&
    after.falsePositive<=before.falsePositive &&
    after.falseNegative<=before.falseNegative &&
    rawF1(after)+1e-12>=rawF1(before) &&
    after.onsetMeanAbsoluteMs<=before.onsetMeanAbsoluteMs+2 &&
    after.matchedOffsetMeanAbsoluteMs<=before.matchedOffsetMeanAbsoluteMs+2;
}
