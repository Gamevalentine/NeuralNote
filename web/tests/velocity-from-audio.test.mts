import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateVelocityFromAudio} from '../src/velocityFromAudio.ts';

const sampleRate = 8000;
const makeNotes = (program=0) => Array.from({length: 8}, (_,i) => ({
  pitchMidi: 60+i%4, startTimeSeconds: 0.5+i, durationSeconds: 0.35,
  program, isDrum: program === 128, amplitude: 0.7874015748
}));
const recording = (notes: ReturnType<typeof makeNotes>, gain=(i:number)=>i%2 ? 0.75 : 0.08) => {
  const samples = new Float32Array(sampleRate * 10);
  notes.forEach((note,i) => {
    const start = Math.round(note.startTimeSeconds * sampleRate);
    for (let j=0; j<sampleRate/5; j++)
      samples[start+j] = gain(i) * Math.sin(2*Math.PI*440*j/sampleRate);
  });
  return {sampleRate,channels:[samples]};
};
test('audio-derived velocity responds to quiet/loud notes but not notes timing or pitch', () => {
  const notes=makeNotes(), before=notes.map(n=>({...n}));
  const result=estimateVelocityFromAudio(notes,recording(notes));
  assert.equal(result.observedTracks,1);
  assert.ok(result.changed>=6);
  assert.ok(result.notes[1].amplitude > result.notes[0].amplitude + .30);
  assert.ok(result.notes[3].amplitude > result.notes[2].amplitude + .30);
  assert.deepEqual(notes,before);
  for(let i=0;i<notes.length;i++) {
    assert.equal(result.notes[i].startTimeSeconds,notes[i].startTimeSeconds);
    assert.equal(result.notes[i].durationSeconds,notes[i].durationSeconds);
    assert.equal(result.notes[i].pitchMidi,notes[i].pitchMidi);
    assert.equal(result.notes[i].program,notes[i].program);
  }
});
test('uniform loudness must not invent variation, or alter a drum track', () => {
  const notes=makeNotes();
  const flat=estimateVelocityFromAudio(notes,recording(notes,()=>.4));
  assert.equal(flat.changed,0);
  assert.deepEqual(flat.notes,notes);
  const drums=makeNotes(128);
  const result=estimateVelocityFromAudio(drums,recording(drums));
  assert.equal(result.changed,0);
  assert.deepEqual(result.notes,drums);
});
test('existing expressive AI velocity is never overwritten', () => {
  const notes=makeNotes().map((n,i)=>({...n,amplitude:i%2?.43:.79}));
  const out=estimateVelocityFromAudio(notes,recording(notes));
  assert.equal(out.changed,0);
  assert.deepEqual(out.notes,notes);
});
test('stereo right-only energy remains measurable; no key force inferred from silence', () => {
  const notes=makeNotes(), right=recording(notes).channels[0];
  const stereo=estimateVelocityFromAudio(notes,{sampleRate,channels:[new Float32Array(right.length),right]});
  assert.ok(stereo.changed>=6);
  const silence=estimateVelocityFromAudio(notes,{sampleRate,channels:[new Float32Array(right.length)]});
  assert.equal(silence.changed,0);
});
test('reject invalid PCM and short recording without changing any input notes', () => {
  const notes=makeNotes();
  assert.throws(()=>estimateVelocityFromAudio(notes,{sampleRate:0,channels:[]}),/hợp lệ/);
  assert.throws(()=>estimateVelocityFromAudio(notes,{sampleRate,channels:[new Float32Array(100)]}),/quá ngắn/);
  const corrupt=recording(notes);corrupt.channels[0][5000]=Number.NaN;
  assert.throws(()=>estimateVelocityFromAudio(notes,corrupt),/không hợp lệ/);
});
