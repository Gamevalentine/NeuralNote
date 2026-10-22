import type {Note} from './audio';
import {scoreAgainstReference,type MidiReference,type MusicMode,type NoteScore} from './referenceBenchmark.ts';

export type WebEvaluation = {
  current:NoteScore;
  imported:NoteScore|null;
  referenceCount:number;
  scope:'piano'|'ensemble';
  suggested:'current'|'imported'|null;
};
function isPianoProgram(p:number|undefined):boolean{return p===undefined||(p>=0&&p<8)}
/** Evaluates local browser notes against USER-provided corresponding reference.
 * "Guided" chooses score scope only using reference GM labels, NEVER audio AI detection.
 * The optional imported MIDI is an offline candidate, not live Transkun inference.
 */
export function evaluateWebMidi(
  current:Note[],reference:MidiReference,mode:MusicMode,offsetSeconds:number,
  candidate?:MidiReference|null,
):WebEvaluation{
  const scope:WebEvaluation['scope']=mode==='guided'
    ?reference.notes.every(n=>isPianoProgram(n.program))?'piano':'ensemble'
    :mode;
  const ref=scope==='piano'
    ?reference.notes.filter(n=>isPianoProgram(n.program)):reference.notes;
  if(ref.length===0)throw Error('MIDI chuẩn không có nốt Piano GM0–7 trong chế độ Piano.');
  const currentNotes=scope==='piano'?current.filter(n=>isPianoProgram(n.program)):current;
  const currentScore=scoreAgainstReference(ref,currentNotes,offsetSeconds);
  const importedNotes=candidate?.notes.map(n=>({
    pitchMidi:n.pitchMidi,startTimeSeconds:n.startTimeSeconds,
    durationSeconds:n.durationSeconds,program:n.program,amplitude:0.7,isDrum:false,
  }));
  const imported=importedNotes?scoreAgainstReference(ref,
    scope==='piano'?importedNotes.filter(n=>isPianoProgram(n.program)):importedNotes,
    offsetSeconds):null;
  const diff=imported?currentScore.f1-imported.f1:0;
  return {
    current:currentScore,imported,referenceCount:ref.length,scope,
    suggested:!imported||Math.abs(diff)<0.02?null:diff>0?'current':'imported'
  };
}
