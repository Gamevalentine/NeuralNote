import type { Note } from './audio';

/**
 * Optional, deterministic velocity estimate using the ORIGINAL audio recording.
 * MuScriptor native v1 emits a constant amplitude (0.7874) because its model
 * predicts note events, not MIDI velocity. This is a MIX-LEVEL proxy, not
 * isolated per-instrument dynamics or recovered pianist key force.
 *
 * No note onset, pitch, duration or pedal event is changed. Tracks with
 * already-varying AI velocity, drums and ambiguous/silent audio stay untouched.
 */
export type VelocityEstimate = {
  notes: Note[];
  changed: number;
  skippedTracks: number;
  observedTracks: number;
};
export type VelocityAudio = {
  sampleRate: number;
  channels: readonly Float32Array[];
};

const groupKey = (note: Note): string =>
  note.program === undefined
    ? 'pitch-' + (note.pitchMidi < 60 ? 'low' : note.pitchMidi < 72 ? 'mid' : 'high')
    : 'gm-' + note.program;
const quantile = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
const bounded = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function estimateVelocityFromAudio(notes: readonly Note[], audio: VelocityAudio): VelocityEstimate {
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000
      || !audio.channels.length || audio.channels.length > 2
      || audio.channels.some(c => !(c instanceof Float32Array)))
    throw Error('Dữ liệu âm thanh chưa hợp lệ để ước lượng velocity.');
  const frameCount = Math.min(...audio.channels.map(c => c.length));
  if (frameCount < audio.sampleRate / 2)
    throw Error('Âm thanh quá ngắn để đo tương quan lực nhấn.');

  // Compute a 20ms RMS envelope once. Bound samples checked to ~8k/s/channel,
  // not O(noteCount * audioLength). Never load models or upload the recording.
  const hop = Math.max(1, Math.round(audio.sampleRate * 0.02));
  const stride = Math.max(1, Math.floor(audio.sampleRate / 8000));
  const envelope = new Float32Array(Math.ceil(frameCount / hop));
  for (let i = 0; i < envelope.length; i++) {
    const start = i * hop, end = Math.min(frameCount, start + hop);
    let power = 0, samples = 0;
    for (let j = start; j < end; j += stride) {
      for (const channel of audio.channels) {
        const value = channel[j];
        if (!Number.isFinite(value)) throw Error('Mẫu âm thanh không hợp lệ.');
        power += value * value;
        samples++;
      }
    }
    envelope[i] = samples ? Math.sqrt(power / samples) : 0;
  }

  const output = notes.map(n => ({...n}));
  const grouped = new Map<string, {index: number; level: number}[]>();
  const lengthSeconds = frameCount / audio.sampleRate;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.isDrum || note.program === 128
      || !Number.isFinite(note.startTimeSeconds) || note.startTimeSeconds < 0
      || !Number.isFinite(note.durationSeconds) || note.durationSeconds <= 0
      || note.startTimeSeconds + 0.12 >= lengthSeconds) continue;
    let level = 0;
    const lo = Math.floor((note.startTimeSeconds + 0.015) / 0.02);
    const hi = Math.min(envelope.length - 1, Math.ceil((note.startTimeSeconds + 0.11) / 0.02));
    for (let k = lo; k <= hi; k++) level = Math.max(level, envelope[k] || 0);
    if (level < 0.0001) continue;
    const key = groupKey(note), group = grouped.get(key) || [];
    group.push({index: i, level: Math.log(0.001 + level)});
    grouped.set(key, group);
  }

  let changed = 0, skippedTracks = 0;
  for (const group of grouped.values()) {
    // Few notes or original expressive velocity: do not invent a dynamics curve.
    const amplitudes = group.map(p => notes[p.index].amplitude);
    if (group.length < 6 || amplitudes.some(a => !Number.isFinite(a))
      || Math.max(...amplitudes) - Math.min(...amplitudes) > 0.06) {
      skippedTracks++;
      continue;
    }
    const levels = group.map(x => x.level).sort((a,b) => a - b);
    const low = quantile(levels, 0.10), high = quantile(levels, 0.90);
    // A constant/squashed input is not evidence of different key force.
    if (high - low < Math.log(1.35)) {
      skippedTracks++;
      continue;
    }
    for (const {index, level} of group) {
      const next = Math.round((0.40 + 0.50 * bounded((level - low) / (high - low), 0, 1)) * 1000) / 1000;
      if (Math.abs(next - output[index].amplitude) > 0.0005) {
        output[index].amplitude = next;
        changed++;
      }
    }
  }
  return {notes: output, changed, skippedTracks, observedTracks: grouped.size};
}
