import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { NoteEventTime } from '@spotify/basic-pitch';
import { Midi } from '@tonejs/midi';

export type Note = NoteEventTime;
export type PitchGroup = 'low' | 'mid' | 'high';
export type AudioInfo = { duration: number; peaks: number[]; sampleRate: number };
export const GROUPS = [
  { id: 'high' as PitchGroup, name: 'Dải cao', code: 'HI', color: '#e4b45b' },
  { id: 'mid' as PitchGroup, name: 'Dải trung', code: 'MID', color: '#47bda0' },
  { id: 'low' as PitchGroup, name: 'Dải trầm', code: 'LOW', color: '#8b83ec' },
];
export const modelUrl = 'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json';

export function groupFor(pitch: number): PitchGroup {
  return pitch < 60 ? 'low' : pitch < 72 ? 'mid' : 'high';
}
export function noteName(pitch: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return names[((pitch % 12) + 12) % 12] + (Math.floor(pitch / 12) - 1);
}
export function fmt(seconds: number): string {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return Math.floor(s / 60).toString().padStart(2, '0') + ':' + Math.floor(s % 60).toString().padStart(2, '0') + '.' + Math.floor((s % 1) * 100).toString().padStart(2, '0');
}
export async function readAudio(file: Blob): Promise<AudioInfo> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error('Tệp âm thanh không hợp lệ.');
    const peaks: number[] = [];
    const cells = 900;
    const channel = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / cells));
    for (let i = 0; i < cells; i++) {
      const start = Math.floor(i * channel.length / cells);
      const end = Math.min(channel.length, start + step);
      let maximum = 0;
      for (let j = start; j < end; j += Math.max(1, Math.floor(step / 75))) {
        maximum = Math.max(maximum, Math.abs(channel[j]));
      }
      peaks.push(maximum);
    }
    return { duration: audio.duration, peaks, sampleRate: audio.sampleRate };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
export async function transcribe(file: Blob, onProgress: (text: string, value: number) => void): Promise<Note[]> {
  const ctx = new AudioContext();
  try {
    onProgress('Đang đọc âm thanh', 4);
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    if (!audio.duration || !Number.isFinite(audio.duration)) throw new Error('Tệp âm thanh không hợp lệ');
    if (audio.duration > 45) throw new Error('Bản thử nghiệm hỗ trợ tối đa 45 giây âm thanh. Hãy cắt một đoạn ngắn hơn.');
    onProgress('Đang chuyển mẫu âm thanh', 12);
    const rate = 22050;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * rate)), rate);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const prepared = await offline.startRendering();
    onProgress('Đang tải mô hình Basic Pitch', 18);
    const engine = new BasicPitch(modelUrl);
    await engine.model;
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];
    await engine.evaluateModel(prepared, (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    }, ratio => onProgress('Đang nhận diện cao độ và trường độ', Math.round(20 + ratio * 73)));
    if (!frames.length) throw new Error('Mô hình không trả dữ liệu nhận diện.');
    onProgress('Đang dựng Piano Roll', 97);
    return noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)))
      .filter(n => n.durationSeconds > 0.03 && n.pitchMidi >= 0 && n.pitchMidi <= 127)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
export function makeMidi(notes: Note[], bpm: number, included: Set<PitchGroup>): Blob {
  const midi = new Midi();
  midi.header.setTempo(Math.min(240, Math.max(40, bpm)));
  for (const group of GROUPS) {
    const items = notes.filter(n => groupFor(n.pitchMidi) === group.id && included.has(group.id));
    if (!items.length) continue;
    const track = midi.addTrack();
    track.name = 'NOTIQ - ' + group.name;
    items.forEach(n => track.addNote({
      midi: Math.round(n.pitchMidi),
      time: Math.max(0, n.startTimeSeconds),
      duration: Math.max(0.04, n.durationSeconds),
      velocity: Math.max(0.1, Math.min(1, n.amplitude)),
    }));
  }
  const bytes = midi.toArray();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'audio/midi' });
}
export function generateDemo(): Blob {
  const rate = 22050;
  const notes = [261.6256, 329.6276, 391.9954, 523.2511, 392, 329.6276, 261.6256, 196];
  const length = notes.length * 0.46 + 0.1;
  const n = Math.floor(length * rate);
  const ab = new ArrayBuffer(44 + n * 2);
  const v = new DataView(ab);
  const str = (start: number, value: string) => { for (let i = 0; i < value.length; i++) v.setUint8(start + i, value.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const time = i / rate;
    const which = Math.floor(time / 0.46);
    let sample = 0;
    if (which < notes.length) {
      const local = time - which * 0.46;
      const volume = Math.min(1, local / 0.025) * Math.min(1, (0.42 - local) / 0.08);
      sample = Math.max(0, volume) * 0.47 * (Math.sin(Math.PI * 2 * notes[which] * time) + 0.14 * Math.sin(Math.PI * 4 * notes[which] * time));
    }
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  }
  return new Blob([ab], { type: 'audio/wav' });
}
