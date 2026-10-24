import type { Note } from './audio';

// One edit gesture (add / drag / resize / delete) is one Undo step.
// Values are in seconds so Web playback and exported MIDI remain in sync.
export const SNAP_SECONDS = 0.125;
export const MIN_NOTE_SECONDS = 0.125;
export const DEFAULT_NOTE_SECONDS = 0.5;

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const snapSeconds = (seconds: number) =>
  Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS;

export const copyNotes = (notes: Note[]) =>
  notes.map(note => ({ ...note, pitchBends: note.pitchBends?.slice() }));

export function addNote(notes: Note[], pitch: number, atSeconds: number, totalSeconds: number): Note[] {
  const startTimeSeconds = clamp(snapSeconds(atSeconds), 0, Math.max(0, totalSeconds - MIN_NOTE_SECONDS));
  const durationSeconds = Math.min(DEFAULT_NOTE_SECONDS, totalSeconds - startTimeSeconds);
  const note: Note = { pitchMidi: clamp(Math.round(pitch), 0, 127),
    startTimeSeconds, durationSeconds, amplitude: 0.75 };
  return [...notes, note];
}

export function updateNote(
  notes: Note[], index: number, next: Partial<Note>, totalSeconds: number,
): Note[] {
  if (!notes[index]) return notes;
  const old = notes[index];
  // Keep the exact timing of AI notes unless that timing field is edited.
  const startTimeSeconds = clamp(
    next.startTimeSeconds === undefined ? old.startTimeSeconds : snapSeconds(next.startTimeSeconds),
    0, Math.max(0, totalSeconds - MIN_NOTE_SECONDS));
  const durationSeconds = clamp(
    next.durationSeconds === undefined ? old.durationSeconds : snapSeconds(next.durationSeconds),
    MIN_NOTE_SECONDS, Math.max(MIN_NOTE_SECONDS, totalSeconds - startTimeSeconds));
  const pitchMidi = clamp(Math.round(next.pitchMidi ?? old.pitchMidi), 0, 127);
  const result = notes.slice();
  result[index] = { ...old, ...next, startTimeSeconds, durationSeconds, pitchMidi,
    // Basic Pitch bends are frame-aligned; don't keep old bends after editing a note.
    pitchBends: (startTimeSeconds !== old.startTimeSeconds
      || durationSeconds !== old.durationSeconds || pitchMidi !== old.pitchMidi)
      ? undefined : old.pitchBends };
  return result;
}

export function removeNote(notes: Note[], index: number): Note[] {
  if (index < 0 || index >= notes.length) return notes;
  return notes.filter((_, i) => i !== index);
}

export const sameNotes = (a: Note[], b: Note[]) =>
  a.length === b.length && a.every((n, i) =>
    n.pitchMidi === b[i].pitchMidi &&
    n.startTimeSeconds === b[i].startTimeSeconds &&
    n.durationSeconds === b[i].durationSeconds &&
    n.amplitude === b[i].amplitude);


/** 5N-B precision editor: one explicit +/-10ms correction, independent of
 * coarse 125ms mouse grid. Moving note-on keeps note-off fixed, while moving
 * note-off keeps note-on fixed. Never shifts any other note or AI output.
 */
export function nudgeNoteBoundary(notes:Note[],index:number,edge:'onset'|'offset',
  deltaSeconds:number,maxSeconds:number):Note[]{
 if(!Number.isInteger(index)||index<0||index>=notes.length||
   !Number.isFinite(deltaSeconds)||Math.abs(deltaSeconds)>0.05||
   !Number.isFinite(maxSeconds)||maxSeconds<=0||!['onset','offset'].includes(edge))
  return notes;
 const original=notes[index];
 const start=original.startTimeSeconds,end=start+original.durationSeconds;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return notes;
 const ceiling=Math.max(maxSeconds,end+0.05); // preserve short note tails near the recording end
 const roundMillis=(value:number)=>Math.round(value*1000)/1000;
 let nextStart=start,nextEnd=end;
 if(edge==='onset')nextStart=roundMillis(clamp(start+deltaSeconds,0,end-0.01));
 else nextEnd=roundMillis(clamp(end+deltaSeconds,start+0.01,ceiling));
 if(Math.abs(nextStart-start)<1e-8&&Math.abs(nextEnd-end)<1e-8)return notes;
 const result=notes.slice();
 result[index]={...original,startTimeSeconds:nextStart,
  durationSeconds:roundMillis(nextEnd-nextStart),pitchBends:undefined};
 return result;
}
