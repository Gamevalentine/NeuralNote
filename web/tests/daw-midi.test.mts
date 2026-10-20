import test from 'node:test';
import assert from 'node:assert/strict';
import toneMidi from '@tonejs/midi';
const { Midi } = toneMidi;
import { unzipSync, strFromU8 } from 'fflate';
import { extractDawTracks, createDawMidi, createDawBundle, midiChannelLimitExceeded } from '../src/dawMidi.ts';

const programs = { high: 73, mid: 24, low: 33 };
const groups = new Set(['high', 'mid', 'low']);
const notes = [
  { pitchMidi: 60, startTimeSeconds: 0.125, durationSeconds: 0.5, amplitude: 0.75, program: 0, isDrum:false },
  { pitchMidi: 60, startTimeSeconds: 0.125, durationSeconds: 0.75, amplitude: 0.78, program: 40, isDrum:false },
  { pitchMidi: 38, startTimeSeconds: 0.375, durationSeconds: 0.01, amplitude: 0.8, program: 128, isDrum:true },
];

test('MuScriptor overlapping pitches are preserved as separate real GM tracks', () => {
  const tracks = extractDawTracks(notes, programs, groups);
  assert.equal(tracks.length, 3);
  const decoded = new Midi(createDawMidi(tracks, 126));
  assert.equal(decoded.tracks.length, 3);
  assert.equal(decoded.header.tempos[0].bpm, 126);
  const a = decoded.tracks.find(track => track.instrument.number === 0 && track.channel !== 9);
  const b = decoded.tracks.find(track => track.instrument.number === 40);
  const drums = decoded.tracks.find(track => track.channel === 9);
  assert.ok(a); assert.ok(b); assert.ok(drums);
  assert.equal(a.notes[0].midi, 60);
  assert.equal(b.notes[0].midi, 60);
  assert.equal(drums.notes[0].midi, 38);
  assert.equal(drums.notes[0].duration, 0.01);
  assert.notEqual(a.channel, b.channel);
  assert.equal(a.notes[0].time, 0.125);
});

test('Pitch-only Basic Pitch tracks retain chosen GM program and seconds', () => {
  const basic = [
    { pitchMidi: 48, startTimeSeconds: 2.5, durationSeconds: 0.5, amplitude: 0.8 },
    { pitchMidi: 64, startTimeSeconds: 3.5, durationSeconds: 1, amplitude: 0.8 },
    { pitchMidi: 85, startTimeSeconds: 4.5, durationSeconds: 0.5, amplitude: 0.8 },
  ];
  const tracks = extractDawTracks(basic, programs, groups);
  assert.equal(tracks.length, 3);
  const midi = new Midi(createDawMidi(tracks, 90));
  assert.deepEqual(midi.tracks.map(track => track.instrument.number), [73,24,33]);
  assert.deepEqual(midi.tracks.map(track => track.notes[0].time), [4.5,3.5,2.5]);
});

test('Muted/invisible source tracks can be filtered before export', () => {
  const tracks = extractDawTracks(notes.filter(n => n.program === 40), programs, groups);
  assert.equal(tracks.length, 1);
  assert.equal(new Midi(createDawMidi(tracks, 110)).tracks[0].instrument.number, 40);
});

test('Kontakt handoff ZIP includes all-track Type 1 MIDI, isolated MIDI stems and honest routing guide', () => {
  const tracks = extractDawTracks(notes, programs, groups);
  const bundle = unzipSync(createDawBundle(tracks, 126));
  const entries = Object.keys(bundle);
  assert.ok(entries.includes('NOTIQ_ALL_TRACKS.mid'));
  const stemNames = entries.filter(name => name.startsWith('MIDI_TRACKS/') && name.endsWith('.mid'));
  assert.equal(stemNames.length, 3);
  for (const stem of stemNames)
    assert.equal(new Midi(bundle[stem]).tracks.length, 1);
  assert.equal(new Midi(bundle['NOTIQ_ALL_TRACKS.mid']).tracks.length, 3);
  const guide = strFromU8(bundle['README_DAW_KONTAKT.txt']);
  assert.match(guide, /126 BPM/);
  assert.match(guide, /Kontakt/);
  assert.match(guide, /channel 10/);
  assert.match(guide, /does not auto-load Kontakt patches/);
});

test('Warn when more than 15 melodic programs share the limited GM port', () => {
  const many = Array.from({length: 17}, (_, i) => ({
    pitchMidi: 50 + i, startTimeSeconds: 0, durationSeconds: 1,
    amplitude: 0.9, program: i, isDrum: false,
  }));
  const tracks = extractDawTracks(many, programs, groups);
  assert.equal(midiChannelLimitExceeded(tracks), true);
  assert.equal(new Midi(createDawMidi(tracks, 120)).tracks.length, 17);
});
