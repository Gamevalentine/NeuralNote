import { Midi } from '@tonejs/midi';
import { zipSync, strToU8 } from 'fflate';
import type { Note, PitchGroup } from './audio';
import { GROUPS, groupFor } from './audio';

export type DawTrack = {
  key: string;
  name: string;
  program: number;
  isDrum: boolean;
  notes: Note[];
};
export type DawPrograms = Record<PitchGroup, number>;
const MIDI_DRUM_CHANNEL = 9;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

const constrain = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const midiBuffer = (midi: Midi): Uint8Array => midi.toArray();

export function extractDawTracks(notes: Note[], programs: DawPrograms, includedGroups: Set<PitchGroup>): DawTrack[] {
  const map = new Map<string, DawTrack>();
  for (const note of notes) {
    if (!Number.isFinite(note.startTimeSeconds) || note.startTimeSeconds < 0 ||
        !Number.isFinite(note.durationSeconds) || note.durationSeconds <= 0 ||
        !Number.isFinite(note.pitchMidi) || note.pitchMidi < 0 || note.pitchMidi > 127) continue;

    if (note.program !== undefined) {
      if (!Number.isInteger(note.program) || note.program < 0 || note.program > 128) continue;
      const program = note.program;
      const key = 'gm-' + program;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: program === 128 ? 'NOTIQ - GM Drums'
            : 'NOTIQ - GM ' + String(program + 1).padStart(3, '0'),
          program: program === 128 ? 0 : program,
          isDrum: program === 128,
          notes: [],
        });
      }
      map.get(key)!.notes.push(note);
    } else {
      const group = groupFor(note.pitchMidi);
      if (!includedGroups.has(group)) continue;
      const key = 'pitch-' + group;
      if (!map.has(key)) {
        const groupNames: Record<PitchGroup, string> =
          { high: 'High', mid: 'Mid', low: 'Low' };
        map.set(key, {
          key,
          name: 'NOTIQ - ' + groupNames[group],
          program: programs[group],
          isDrum: false,
          notes: [],
        });
      }
      map.get(key)!.notes.push(note);
    }
  }
  const groupOrder = GROUPS.map(g => 'pitch-' + g.id);
  return [...map.values()].sort((a,b) => {
    if (a.isDrum !== b.isDrum) return a.isDrum ? 1 : -1;
    const aIdx = groupOrder.indexOf(a.key), bIdx = groupOrder.indexOf(b.key);
    if (aIdx >= 0 || bIdx >= 0) return (aIdx < 0 ? 999 : aIdx) - (bIdx < 0 ? 999 : bIdx);
    return Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]);
  });
}

function addNotes(midi: Midi, group: DawTrack, channel: number) {
  const track = midi.addTrack();
  track.name = group.name;
  track.channel = channel;
  track.instrument.number = group.program;
  for (const note of group.notes) {
    track.addNote({
      midi: Math.round(note.pitchMidi),
      time: note.startTimeSeconds,
      duration: Math.max(0.01, note.durationSeconds),
      velocity: constrain(Number.isFinite(note.amplitude) ? note.amplitude : 0.78, 0.01, 1),
    });
  }
}

/**
 * Standard MIDI File (Type 1): independent MIDI tracks, shared tempo and a
 * reserved GM drum channel (zero-based 9 / DAW channel 10).
 * 15 is the maximum number of simultaneous melodic channels in a single GM port.
 * More programs are still exported as tracks, but share channels; individual
 * isolated stem MIDI files avoid such conflicts.
 */
export function createDawMidi(tracks: DawTrack[], bpm: number): Uint8Array {
  const midi = new Midi();
  midi.header.name = 'NOTIQ - DAW multitrack';
  midi.header.setTempo(constrain(Math.round(bpm), 40, 240));
  let melodic = 0;
  for (const track of tracks) {
    addNotes(midi, track, track.isDrum
      ? MIDI_DRUM_CHANNEL
      : MELODIC_CHANNELS[melodic++ % MELODIC_CHANNELS.length]);
  }
  return midiBuffer(midi);
}

function safeFilename(name: string) {
  return name.replace(/[^A-Za-z0-9 _-]/g, '_').replace(/\s+/g,'_').slice(0,78);
}

export function createDawBundle(tracks: DawTrack[], bpm: number): Uint8Array {
  const content: Record<string, Uint8Array> = {};
  content['NOTIQ_ALL_TRACKS.mid'] = createDawMidi(tracks, bpm);
  tracks.forEach((track, index) => {
    const filename = String(index + 1).padStart(2, '0') + '_' + safeFilename(track.name) + '.mid';
    content['MIDI_TRACKS/' + filename] = createDawMidi([track], bpm);
  });
  const guide = [
    'NOTIQ - Cubase / Cakewalk / Kontakt handoff',
    '==========================================',
    '',
    'Tempo: ' + constrain(Math.round(bpm), 40, 240) + ' BPM',
    'MIDI Type 1: NOTIQ_ALL_TRACKS.mid',
    'Track stems: MIDI_TRACKS/*.mid (one instrument per file).',
    'Each file contains notes, timing, velocity and a GM program number.',
    '',
    'DAW workflow:',
    '1. Import NOTIQ_ALL_TRACKS.mid in Cubase or Cakewalk, preserving separate MIDI tracks.',
    '2. Set your project tempo to the tempo shown above if the DAW does not import tempo metadata.',
    '3. Create a Kontakt instrument for each melodic MIDI track and route track MIDI output to it.',
    '4. Open the required .nki library manually in Kontakt. GM program does not auto-load Kontakt patches.',
    '5. Drums use GM MIDI channel 10 and GM drum pitches; route to a drum instrument/kit.',
    '6. If a DAW merges tracks, import individual MIDI_TRACKS/*.mid one at a time.',
    '7. If there are more than 15 melodic instruments, prefer individual stems to avoid GM channel reuse.',
    '',
    'TRACKS:',
    ...tracks.map((track, index) =>
      (index + 1) + '. ' + track.name + ' | ' + track.notes.length
       + ' notes | ' + (track.isDrum ? 'GM drums / channel 10'
         : 'GM program ' + (track.program + 1))),
    '',
    'NOTIQ cannot automatically assign a specific Kontakt .nki without direct DAW/plugin integration.',
    'MuScriptor GGUF weights license: CC BY-NC 4.0; do not distribute commercially.',
  ].join('\r\n');
  content['README_DAW_KONTAKT.txt'] = strToU8(guide);
  return zipSync(content, { level: 5 });
}

export function midiChannelLimitExceeded(tracks: DawTrack[]) {
  return tracks.filter(track => !track.isDrum).length > MELODIC_CHANNELS.length;
}
