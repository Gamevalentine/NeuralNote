import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {Midi}=createRequire(import.meta.url)('@tonejs/midi');
import {scoreAgainstReference,benchmarkComparison,readReferenceMidi} from '../src/referenceBenchmark.ts';
const note=(pitchMidi:number,startTimeSeconds:number,durationSeconds=0.4,program=0)=>({
 pitchMidi,startTimeSeconds,durationSeconds,amplitude:0.7,program,isDrum:false
});
const ref=(pitchMidi:number,startTimeSeconds:number,durationSeconds=0.4,program=0)=>({
 pitchMidi,startTimeSeconds,durationSeconds,program
});
test('100ms pitch/onset strict scoring measures TP FP FN, precision recall F1',()=>{
 const s=scoreAgainstReference([ref(60,1),ref(62,2),ref(64,3)],
  [note(60,1.03),note(65,2),note(64,3.02)]);
 assert.deepEqual([s.truePositive,s.falsePositive,s.falseNegative],[2,1,1]);
 assert.equal(s.precision,0.6667);assert.equal(s.recall,0.6667);assert.equal(s.f1,0.6667);
 assert.equal(s.onsetMeanAbsoluteMs,25);
});
test('duplicate same-pitch notes cannot claim two correct matches for one reference event',()=>{
 const s=scoreAgainstReference([ref(60,1)],[note(60,1),note(60,1.01)]);
 assert.deepEqual([s.truePositive,s.falsePositive,s.falseNegative],[1,1,0]);
});
test('100ms outside tolerance is an error; offsets checked separately',()=>{
 const s=scoreAgainstReference([ref(60,2,1)],[note(60,2.11,0.4)]);
 assert.deepEqual([s.truePositive,s.falsePositive,s.falseNegative],[0,1,1]);
 const q=scoreAgainstReference([ref(60,2,1)],[note(60,2.05,0.3)]);
 assert.equal(q.truePositive,1);
 assert.equal(q.offsetWithinTolerance,0);
 assert.equal(q.matchedOffsetMeanAbsoluteMs,650);
});
test('manual +200ms reference MIDI offset handles fixed recording lead-in',()=>{
 const notes=[ref(62,1)];
 assert.equal(scoreAgainstReference(notes,[note(62,1.2)]).truePositive,0);
 assert.equal(scoreAgainstReference(notes,[note(62,1.2)],.2).truePositive,1);
 assert.throws(()=>scoreAgainstReference(notes,[],6),/\+5 giây/);
});
test('real Type1 MIDI parsing reads tempo, independent tracks, and ignores drums',async()=>{
 const midi=new Midi();midi.header.setTempo(90);
 const piano=midi.addTrack();piano.instrument.number=0;
 piano.addNote({midi:60,time:1,duration:.5,velocity:.8});
 const drums=midi.addTrack();drums.channel=9;
 drums.addNote({midi:38,time:1,duration:.2,velocity:.9});
 const data=midi.toArray();
 const loaded=await readReferenceMidi(new Blob([data]),'answer.mid');
 assert.equal(loaded.notes.length,1);assert.equal(loaded.notes[0].pitchMidi,60);
 assert.ok(Math.abs(loaded.notes[0].durationSeconds-.5)<0.002);
 assert.equal(loaded.tracks,1);
});
test('Piano excludes non-piano MuScriptor instruments, auto needs reference evidence',()=>{
 const base={engine:'muscriptor' as const,notes:[note(60,1,0.4,0),note(64,2,0.4,30)],pedalEvents:[]};
 const piano={engine:'transkun-v2' as const,notes:[note(60,1)],pedalEvents:[]};
 const result={muscriptor:base,transkun:piano,pairs:[],muscriptorOnly:[],transkunOnly:[],
   meanAbsOnsetDifferenceMs:0,meanAbsDurationDifferenceMs:0};
 const gt={fileName:'reference.mid',tracks:1,durationSeconds:3,notes:[ref(60,1)]};
 const p=benchmarkComparison(result,gt,'piano');
 assert.equal(p.muscriptor.f1,1);
 assert.equal(p.transkun.f1,1);
 assert.equal(p.recommended,null);
 const multi=benchmarkComparison(result,gt,'ensemble');
 assert.ok(multi.transkun.f1>multi.muscriptor.f1);
 assert.equal(multi.recommended,'transkun-v2');
});
