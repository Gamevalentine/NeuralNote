import type {Note} from './audio';
import type {PedalEvent} from './pedal';
import {groupFor} from './audio.ts';
/** Derive SoundFont sample release from explicit CC64, without modifying exported
 * note-off timestamps. This approximates sustain by extending the sample voice:
 * it is NOT physical damper resonance or automatic pedal detection.
 */
export function soundingDurationWithPedal(
 note:Note,events:PedalEvent[],maxDuration=8
):number{
 const nominal=Math.max(0.07,Math.min(maxDuration,note.durationSeconds));
 if(note.isDrum||note.program===128||!events.length)return nominal;
 const trackKey=note.program===undefined?'pitch-'+groupFor(note.pitchMidi):'gm-'+note.program;
 const noteOff=note.startTimeSeconds+note.durationSeconds;
 if(!Number.isFinite(noteOff))return nominal;
 const applicable=events.filter(e=>(e.trackKey==='*'||e.trackKey===trackKey)&&
   Number.isFinite(e.timeSeconds)&&e.timeSeconds>=0&&
   (e.value===0||e.value===127))
  .sort((a,b)=>a.timeSeconds-b.timeSeconds||
   (a.trackKey==='*'?-1:1));
 let down=false,index=0;
 while(index<applicable.length&&applicable[index].timeSeconds<=noteOff+1e-8){
  down=applicable[index].value===127;index++;
 }
 if(!down)return nominal;
 // Need an explicit release to bound sustain, not a never-ending synthetic note.
 for(;index<applicable.length;index++){
  if(applicable[index].value===0)
   return Math.max(nominal,Math.min(maxDuration,applicable[index].timeSeconds-note.startTimeSeconds));
 }
 return nominal;
}
