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
  const startTimeSeconds = clamp(snapSeconds(next.startTimeSeconds ?? old.startTimeSeconds),
    0, Math.max(0, totalSeconds - MIN_NOTE_SECONDS));
  const durationSeconds = clamp(snapSeconds(next.durationSeconds ?? old.durationSeconds),
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
