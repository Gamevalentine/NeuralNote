import test from 'node:test';
import assert from 'node:assert/strict';
import { addNote, clamp, copyNotes, removeNote, sameNotes, SNAP_SECONDS, updateNote } from '../src/pianoEdit.ts';

test('new note snaps to 1/8 second and has valid MIDI velocity', () => {
  const next = addNote([], 60.4, 1.19, 8);
  assert.equal(SNAP_SECONDS, 0.125);
  assert.equal(next.length, 1);
  assert.equal(next[0].pitchMidi, 60);
  assert.equal(next[0].startTimeSeconds, 1.25);
  assert.equal(next[0].durationSeconds, 0.5);
  assert.equal(next[0].amplitude, 0.75);
});

test('dragging an AI note preserves its original unquantized duration', () => {
  const original = [{ pitchMidi: 64, startTimeSeconds: 0.035, durationSeconds: 0.231, amplitude: 0.8, pitchBends: [2,1] }];
  const next = updateNote(original, 0, { startTimeSeconds: 1.11, pitchMidi: 66 }, 8);
  assert.equal(next[0].startTimeSeconds, 1.125);
  assert.equal(next[0].durationSeconds, 0.231);
  assert.equal(next[0].pitchMidi, 66);
  assert.equal(next[0].pitchBends, undefined);
  assert.equal(original[0].startTimeSeconds, 0.035);
});

test('resizing changes length only; original precise onset remains', () => {
  const original = [{ pitchMidi: 60, startTimeSeconds: 0.035, durationSeconds: 0.231, amplitude: 0.8 }];
  const next = updateNote(original, 0, { durationSeconds: 0.47 }, 8);
  assert.equal(next[0].startTimeSeconds, 0.035);
  assert.equal(next[0].durationSeconds, 0.5);
});

test('boundaries are valid at the end of timeline', () => {
  const next = addNote([], 88, 100, 8);
  assert.equal(next[0].startTimeSeconds, 7.875);
  assert.equal(next[0].durationSeconds, 0.125);
  assert.equal(clamp(11, 0, 8), 8);
});

test('delete, deep snapshots and unchanged detection support one-step undo', () => {
  const original = [{ pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 0.5, amplitude: 0.7, pitchBends: [1,2] }];
  const saved = copyNotes(original);
  const without = removeNote(original, 0);
  assert.equal(without.length, 0);
  assert.equal(saved.length, 1);
  original[0].pitchBends[0] = 99;
  assert.equal(saved[0].pitchBends[0], 1);
  assert.equal(sameNotes(saved, without), false);
  assert.equal(sameNotes(saved, copyNotes(saved)), true);
});
