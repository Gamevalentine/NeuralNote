// NOTIQ Stage 3: offline Standard MIDI File encoder; no dependencies, no server.
// Input is the actual MuScriptor schema=1 output from NOTIQ's WASM engine.
// General MIDI type 1 / PPQ 480 / fixed tempo 120 BPM.
const PPQ = 480;
const BPM = 120;
const MICROS_PER_QUARTER = Math.round(60_000_000 / BPM);
const TICKS_PER_SECOND = PPQ * BPM / 60;

function vlq(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0FFFFFFF) {
    throw new Error('MIDI delta-time out of range');
  }
  const result = [value & 0x7f];
  for (let n = value >>> 7; n; n >>>= 7) result.unshift((n & 0x7f) | 0x80);
  return result;
}
function chunk(id, payload) {
  const bytes = new TextEncoder().encode(id);
  const len = payload.length;
  if (len > 0xffffffff) throw new Error('MIDI chunk too large');
  return [...bytes, (len >>> 24) & 255, (len >>> 16) & 255,
    (len >>> 8) & 255, len & 255, ...payload];
}
function isNoteValid(n) {
  return Number.isFinite(n.startTimeSeconds) && n.startTimeSeconds >= 0 &&
    Number.isFinite(n.durationSeconds) && n.durationSeconds > 0 &&
    Number.isInteger(n.pitchMidi) && n.pitchMidi >= 0 && n.pitchMidi <= 127 &&
    Number.isInteger(n.program) && n.program >= 0 && n.program <= 128 &&
    typeof n.isDrum === 'boolean' && n.isDrum === (n.program === 128) &&
    Number.isFinite(n.amplitude) && n.amplitude >= 0 && n.amplitude <= 1;
}
function toTicks(seconds) {
  return Math.max(0, Math.round(seconds * TICKS_PER_SECOND));
}
function buildTrack(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order || a.pitch - b.pitch);
  let last = 0;
  const bytes = [];
  for (const event of events) {
    bytes.push(...vlq(event.tick - last), ...event.data);
    last = event.tick;
  }
  bytes.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', bytes);
}
export function notesToMidi(source) {
  if (!source || source.schema !== 1 || source.engine !== 'muscriptor' ||
      !Array.isArray(source.notes) || source.notes.length > 150000 ||
      !source.notes.every(isNoteValid)) {
    throw new Error('Invalid MuScriptor note events; MIDI export aborted');
  }
  const groups = new Map();
  for (const n of source.notes) {
    const key = n.isDrum ? 128 : n.program;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  // 15 available melodic channels: 0..8 + 10..15; channel 9 reserved drums.
  const programs = [...groups.keys()].filter(x => x !== 128).sort((a, b) => a - b);
  const melodyChannels = Array.from({length:16}, (_, i) => i).filter(x => x !== 9);
  if (programs.length > melodyChannels.length) {
    throw new Error('MIDI has more than 15 concurrent instrument programs; multi-port export is not supported');
  }
  const channels = new Map(programs.map((program, i) => [program, melodyChannels[i]]));
  if (groups.has(128)) channels.set(128, 9);

  const tempo = [
    0, 0xff, 0x51, 0x03,
    (MICROS_PER_QUARTER >>> 16) & 255,
    (MICROS_PER_QUARTER >>> 8) & 255,
    MICROS_PER_QUARTER & 255,
    0, 0xff, 0x2f, 0,
  ];
  const tracks = [chunk('MTrk', tempo)];
  for (const [program, notes] of [...groups.entries()].sort((a,b)=>a[0]-b[0])) {
    const channel = channels.get(program);
    const events = [];
    if (program !== 128) {
      events.push({tick: 0, order: -1, pitch: 0, data: [0xc0 | channel, program]});
    }
    for (const note of notes) {
      const start = toTicks(note.startTimeSeconds);
      const end = Math.max(start + 1, toTicks(note.startTimeSeconds + note.durationSeconds));
      const velocity = Math.max(1, Math.min(127, Math.round(note.amplitude * 127)));
      // Note-offs before note-ons at the same tick avoids stuck overlapping notes.
      events.push({tick: end, order: 0, pitch:note.pitchMidi, data:[0x80 | channel, note.pitchMidi, 0]});
      events.push({tick: start, order: 1, pitch:note.pitchMidi, data:[0x90 | channel, note.pitchMidi, velocity]});
    }
    tracks.push(buildTrack(events));
  }
  const count = tracks.length;
  const header = chunk('MThd', [0,1,(count >>> 8)&255,count&255, (PPQ>>>8)&255, PPQ&255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
