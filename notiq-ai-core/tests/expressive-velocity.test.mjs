import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateNoteVelocities } from '../web/expressive-velocity.mjs';

const rate=16000;
const mkNote=(index,program=0)=>({
  startTimeSeconds:0.25+index*0.42,durationSeconds:0.23,pitchMidi:69,
  program,isDrum:program===128,amplitude:0.7874015748
});
const notes=Array.from({length:20},(_,i)=>mkNote(i));
const samples=new Float32Array(rate*9);
for(let i=0;i<notes.length;i++){
  const start=Math.round(notes[i].startTimeSeconds*rate);
  const amp=i%2===0?0.07:0.50;
  for(let j=0;j<3500;j++) {
    const envelope=Math.exp(-j/(rate*0.15));
    samples[start+j]+=amp*Math.sin(2*Math.PI*440*j/rate)*envelope;
  }
}
test('real audio amplitude drives varied velocities without changing timing or pitches',()=>{
  const x=estimateNoteVelocities(notes,samples);
  assert.equal(x.notes.length,notes.length);
  assert.equal(x.report.estimated,20);
  assert.ok(x.report.maxAmplitude-x.report.minAmplitude>0.25,
    'true audio velocity energy range must not be flat');
  for(let i=0;i<notes.length;i++){
    assert.equal(x.notes[i].pitchMidi,notes[i].pitchMidi);
    assert.equal(x.notes[i].program,notes[i].program);
    assert.equal(x.notes[i].startTimeSeconds,notes[i].startTimeSeconds);
    assert.equal(x.notes[i].durationSeconds,notes[i].durationSeconds);
    assert.equal(x.notes[i].velocitySource,'audio-energy-estimate');
  }
  assert.equal(x.report.pedalEstimated,false,'never fabricate sustain pedal');
});
test('silent signal does not hallucinate dynamics',()=>{
  const s=new Float32Array(samples.length);
  const x=estimateNoteVelocities(notes,s);
  assert.equal(x.report.estimated,0);
  assert.deepEqual(x.notes,notes);
});
test('never modifies drums or tiny note groups without evidence',()=>{
  const a=[mkNote(0),mkNote(1,128),mkNote(2)];
  const x=estimateNoteVelocities(a,samples);
  assert.equal(x.report.estimated,0);
  assert.deepEqual(x.notes,a);
});
test('reject invalid sample-rate and source contracts',()=>{
  assert.throws(()=>estimateNoteVelocities(notes,samples,44100),/16k/);
  assert.throws(()=>estimateNoteVelocities(null,samples),/16k/);
});
