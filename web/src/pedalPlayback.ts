import type {Note} from './audio';
import type {PedalEvent} from './pedal';
import {effectivePedalEvents} from './pedal';
// Same pitch-group boundaries as NOTIQ audio.ts, without importing browser AI.
const groupFor=(pitch:number)=>pitch<60?'low':pitch<72?'mid':'high';
/** Approximate sample sustain to next CC64 up. DO NOT change MIDI note-off.
 * CC64 timeline resolution is SHARED with MIDI export, including local track
 * priority over simultaneous global events; no physical damper resonance.
 */
export function soundingDurationWithPedal(
 note:Note,events:PedalEvent[],maxDuration=8
):number{
 const nominal=Math.max(0.07,Math.min(maxDuration,note.durationSeconds));
 if(note.isDrum||note.program===128||!events.length)return nominal;
 const trackKey=note.program===undefined?'pitch-'+groupFor(note.pitchMidi):'gm-'+note.program;
 const noteOff=note.startTimeSeconds+note.durationSeconds;
 if(!Number.isFinite(noteOff))return nominal;
 const timeline=effectivePedalEvents(trackKey,events);
 let down=false,index=0;
 while(index<timeline.length&&timeline[index].timeSeconds<=noteOff+1e-8){
   down=timeline[index].value===127;
   index++;
 }
 if(!down)return nominal;
 // If no explicit release exists we DO NOT invent an infinite sample hold.
 for(;index<timeline.length;index++){
   if(timeline[index].value===0)
     return Math.max(nominal,Math.min(maxDuration,timeline[index].timeSeconds-note.startTimeSeconds));
 }
 return nominal;
}
