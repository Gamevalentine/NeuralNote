import test from 'node:test';
import assert from 'node:assert/strict';
import { isMuScriptorResult, nativeInstrumentPrograms, nativeProgramName, toPianoNotes } from '../src/muscriptorProtocol.ts';

const sample = {
  schema: 1, engine: 'muscriptor',
  notes: [
    { startTimeSeconds: 0.23, durationSeconds: 0.27, pitchMidi: 60,
      program: 0, isDrum: false, amplitude: 100/127 },
    { startTimeSeconds: 0.33, durationSeconds: 0.01, pitchMidi: 38,
      program: 128, isDrum: true, amplitude: 100/127 },
    { startTimeSeconds: 1.23, durationSeconds: 0.47, pitchMidi: 60,
      program: 40, isDrum: false, amplitude: 100/127 },
  ],
} as const;

test('accepts real multi-instrument MuScriptor protocol', () => {
  assert.ok(isMuScriptorResult(sample));
  const notes = toPianoNotes(sample as any);
  assert.equal(notes.length, 3);
  assert.deepEqual(nativeInstrumentPrograms(notes), [0, 40, 128]);
  assert.equal(notes[0].startTimeSeconds, 0.23);
  assert.equal(notes[0].program, 0);
  assert.equal(notes[1].program, 128);
});
test('rejects fake instrument or malformed drum event', () => {
  assert.equal(isMuScriptorResult({ ...sample, engine: 'basic-pitch' }), false);
  assert.equal(isMuScriptorResult({ ...sample, notes: [{ ...sample.notes[0], program: 129 }] }), false);
  assert.equal(isMuScriptorResult({ ...sample, notes: [{ ...sample.notes[1], isDrum: false }] }), false);
});
test('instrument family labels include drums', () => {
  assert.match(nativeProgramName(128), /Trống/);
  assert.match(nativeProgramName(0), /Piano/);
});
