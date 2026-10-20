import type { Note } from './audio';

export const MUSCRIPTOR_SCHEMA = 1;
export const DRUM_PROGRAM = 128;

export type MuScriptorRawNote = {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  program: number;
  isDrum: boolean;
  amplitude: number;
};
export type MuScriptorResult = {
  schema: 1;
  engine: 'muscriptor';
  notes: MuScriptorRawNote[];
};

export function isMuScriptorResult(value: unknown): value is MuScriptorResult {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  if (payload.schema !== MUSCRIPTOR_SCHEMA || payload.engine !== 'muscriptor' || !Array.isArray(payload.notes)) return false;
  if (payload.notes.length > 150_000) return false;
  return payload.notes.every(note => {
    if (!note || typeof note !== 'object') return false;
    const n = note as Record<string, unknown>;
    return typeof n.startTimeSeconds === 'number' && Number.isFinite(n.startTimeSeconds) && n.startTimeSeconds >= 0
      && typeof n.durationSeconds === 'number' && Number.isFinite(n.durationSeconds) && n.durationSeconds > 0
      && typeof n.pitchMidi === 'number' && Number.isInteger(n.pitchMidi) && n.pitchMidi >= 0 && n.pitchMidi <= 127
      && typeof n.program === 'number' && Number.isInteger(n.program) && n.program >= 0 && n.program <= DRUM_PROGRAM
      && typeof n.amplitude === 'number' && Number.isFinite(n.amplitude) && n.amplitude >= 0 && n.amplitude <= 1
      && typeof n.isDrum === 'boolean' && n.isDrum === (n.program === DRUM_PROGRAM);
  });
}

export function toPianoNotes(result: MuScriptorResult): Note[] {
  if (!isMuScriptorResult(result)) throw new Error('Kết quả MuScriptor không hợp lệ.');
  return result.notes.map(n => ({
    pitchMidi: n.pitchMidi,
    startTimeSeconds: n.startTimeSeconds,
    durationSeconds: n.durationSeconds,
    amplitude: n.amplitude,
    program: n.program,
    isDrum: n.isDrum,
  }));
}

export function nativeInstrumentPrograms(notes: Note[]): number[] {
  return [...new Set(notes.filter(n => n.program !== undefined).map(n => n.program!))]
    .sort((a, b) => a - b);
}

export function nativeProgramName(program: number): string {
  if (program === DRUM_PROGRAM) return 'Trống (GM Drum Kit)';
  const label = ['Piano','Guitar','Bass','Strings','Brass','Woodwinds'];
  const family = program < 24 ? 0 : program < 32 ? 1 : program < 40 ? 2
    : program < 56 ? 3 : program < 72 ? 4 : 5;
  return label[family] + ' (GM ' + (program + 1) + ')';
}
