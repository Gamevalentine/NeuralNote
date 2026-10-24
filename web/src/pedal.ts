/**
 * Optional, user-entered sustain pedal controller events (MIDI CC64).
 * MuScriptor predicts notes only: these events are NOT inferred from audio.
 * Pedal timing is tracked in seconds and never changes detected note data.
 */
export type PedalEvent = {
  trackKey: string; // '*' affects every non-drum MIDI track
  timeSeconds: number;
  value: 0 | 127;
};
type NoteSpan = { startTimeSeconds: number; durationSeconds: number };
type PedalTrack = { key: string; isDrum: boolean; notes: NoteSpan[] };
const MAX_SECONDS=900;
const roundMs=(v:number)=>Math.round(v*1000)/1000;
const valid=(e:PedalEvent)=>!!e.trackKey&&Number.isFinite(e.timeSeconds)&&
 e.timeSeconds>=0&&e.timeSeconds<=MAX_SECONDS&&(e.value===0||e.value===127);

export function addPedalPoint(existing: PedalEvent[], event: PedalEvent): PedalEvent[] {
  if (!valid(event)) return existing;
  const timeSeconds=roundMs(event.timeSeconds);
  return [...existing.filter(point =>
    !(point.trackKey === event.trackKey && Math.abs(point.timeSeconds - timeSeconds) < 0.001)),
    { ...event, timeSeconds }]
    .sort((a,b) => a.timeSeconds-b.timeSeconds || a.trackKey.localeCompare(b.trackKey));
}

/** Combined global + local events. At the exact same millisecond a local
 * event wins, in BOTH playback and exported MIDI. Invalid events ignored.
 */
export function effectivePedalEvents(trackKey:string,events:readonly PedalEvent[]):PedalEvent[]{
  const byMs=new Map<number,PedalEvent>();
  for(const e of events){
    if(!valid(e)||(e.trackKey!=='*'&&e.trackKey!==trackKey))continue;
    const ms=Math.round(e.timeSeconds*1000),existing=byMs.get(ms);
    if(!existing||e.trackKey===trackKey)
      byMs.set(ms,{trackKey,timeSeconds:ms/1000,value:e.value});
  }
  const ordered=[...byMs.values()].sort((a,b)=>a.timeSeconds-b.timeSeconds);
  const result:PedalEvent[]=[];let down=false;
  for(const e of ordered){
    const next=e.value===127;
    if(down===next)continue;
    down=next;result.push(e);
  }
  return result;
}
export function pedalDownAt(trackKey:string,events:readonly PedalEvent[],seconds:number):boolean{
  if(!Number.isFinite(seconds)||seconds<0)return false;
  let down=false;
  for(const e of effectivePedalEvents(trackKey,events)){
    if(e.timeSeconds>seconds+1e-8)break;
    down=e.value===127;
  }
  return down;
}
/** One-click bounded down/up pair, never a dangling artificial down event. */
export function addPedalSpan(existing:PedalEvent[],trackKey:string,start:number,end:number):PedalEvent[]{
  if(!trackKey||!Number.isFinite(start)||!Number.isFinite(end)||
    start<0||end>MAX_SECONDS||end-start<0.02||end-start>8)return existing;
  const from=roundMs(start),to=roundMs(end);
  if(to<=from+0.01||pedalDownAt(trackKey,existing,from))return existing;
  return addPedalPoint(addPedalPoint(existing,{trackKey,timeSeconds:from,value:127}),
    {trackKey,timeSeconds:to,value:0});
}
/** Nudge a selected event without overtaking its same-track neighbours. */
export function shiftPedalPoint(existing:PedalEvent[],index:number,deltaSeconds:number):PedalEvent[]{
  if(!Number.isInteger(index)||index<0||index>=existing.length||
    !Number.isFinite(deltaSeconds)||Math.abs(deltaSeconds)>0.1)return existing;
  const target=existing[index];
  if(!valid(target))return existing;
  const time=roundMs(target.timeSeconds+deltaSeconds);
  if(time<0||time>MAX_SECONDS)return existing;
  for(let i=0;i<existing.length;i++){
    if(i===index||existing[i].trackKey!==target.trackKey)continue;
    const e=existing[i];
    if(Math.abs(e.timeSeconds-time)<0.005)return existing;
    if(e.timeSeconds<target.timeSeconds&&e.timeSeconds>=time-0.005)return existing;
    if(e.timeSeconds>target.timeSeconds&&e.timeSeconds<=time+0.005)return existing;
  }
  if(time===target.timeSeconds)return existing;
  return existing.map((e,i)=>i===index?{...e,timeSeconds:time}:e)
    .sort((a,b)=>a.timeSeconds-b.timeSeconds||a.trackKey.localeCompare(b.trackKey));
}
export function eventsForPedalTrack(track:PedalTrack,events:PedalEvent[]):PedalEvent[]{
  if(track.isDrum||!track.notes.length)return [];
  let lastNoteEnd=0;
  for(const n of track.notes)
    lastNoteEnd=Math.max(lastNoteEnd,n.startTimeSeconds+n.durationSeconds);
  if(!Number.isFinite(lastNoteEnd)||lastNoteEnd<0)return [];
  const timeline=effectivePedalEvents(track.key,events);
  const result:PedalEvent[]=[];let down=false;
  for(const e of timeline){
    if(e.timeSeconds>lastNoteEnd+8)break;
    if(e.value===127&&e.timeSeconds>lastNoteEnd)continue;
    down=e.value===127;
    result.push(e);
  }
  // Always close unfinished sustain slightly AFTER the final MIDI note.
  if(down)result.push({trackKey:track.key,timeSeconds:roundMs(lastNoteEnd+0.01),value:0});
  return result;
}
