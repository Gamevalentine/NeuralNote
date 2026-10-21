import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Midi} from '@tonejs/midi';
import {evaluateWebMidi} from '../src/webBenchmark.ts';
import {readReferenceMidi} from '../src/referenceBenchmark.ts';
const createNote=(midi:number,time:number,program=0)=>({pitchMidi:midi,startTimeSeconds:time,durationSeconds:0.4,program,isDrum:false,amplitude:0.75});
test('Web currently recognized MuScriptor output scores against supplied matched MIDI locally',()=>{
 const correct={fileName:'ref.mid',durationSeconds:3,tracks:1,notes:[
  {pitchMidi:60,startTimeSeconds:1,durationSeconds:.4,program:0},
  {pitchMidi:62,startTimeSeconds:2,durationSeconds:.4,program:0}
 ]};
 const a=evaluateWebMidi([createNote(60,1.04),createNote(63,2)],correct,'piano',0);
 assert.deepEqual([a.current.truePositive,a.current.falsePositive,a.current.falseNegative],[1,1,1]);
 assert.equal(a.current.f1,.5);
 assert.equal(a.imported,null);assert.equal(a.suggested,null);
});
test('External MIDI candidate is scored but never mislabeled a live Transkun inference',()=>{
 const ref={fileName:'ref.mid',durationSeconds:2,tracks:1,notes:[{pitchMidi:60,startTimeSeconds:1,durationSeconds:.4,program:0}]};
 const candidate={...ref,fileName:'transkun-export.mid'};
 const a=evaluateWebMidi([createNote(62,1)],ref,'ensemble',0,candidate);
 assert.equal(a.current.f1,0);
 assert.equal(a.imported?.f1,1);
 assert.equal(a.suggested,'imported');
});
test('Piano mode filters out nonpiano program and Guided mode depends solely on reference programs',()=>{
 const reference={fileName:'ref.mid',durationSeconds:3,tracks:2,notes:[
  {pitchMidi:60,startTimeSeconds:1,durationSeconds:.4,program:0},
  {pitchMidi:48,startTimeSeconds:2,durationSeconds:.4,program:32}
 ]};
 const pred=[createNote(60,1),createNote(48,2,32)];
 const piano=evaluateWebMidi(pred,reference,'piano',0);
 assert.equal(piano.referenceCount,1);assert.equal(piano.current.f1,1);
 const guided=evaluateWebMidi(pred,reference,'guided',0);
 assert.equal(guided.scope,'ensemble');assert.equal(guided.referenceCount,2);
});
test('MIDI notes parsed from genuine Type 1 bytes then scored without network or mock models',async()=>{
 const midi=new Midi(),track=midi.addTrack();
 track.instrument.number=0;track.addNote({midi:69,time:1,duration:.5});
 const data=midi.toArray();const file=new Blob([data]);
 const reference=await readReferenceMidi(file,'piano.mid');
 const score=evaluateWebMidi([createNote(69,1)],reference,'guided',0);
 assert.equal(score.current.f1,1);
 assert.equal(score.scope,'piano');
});
