import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewNearExactDuplicates,diagnoseAgainstReference,cleanupPreservesReference} from '../src/noteQuality5NB.ts';
import {scoreAgainstReference} from '../src/referenceBenchmark.ts';

const n=(pitchMidi:number,startTimeSeconds:number,durationSeconds=.5,program=0,amplitude=.78)=>({
  pitchMidi,startTimeSeconds,durationSeconds,program,amplitude,isDrum:program===128
});
const r=(pitchMidi:number,startTimeSeconds:number,durationSeconds=.5,program=0)=>({
  pitchMidi,startTimeSeconds,durationSeconds,program
});
test('5NB removes one genuine same-pitch/program near-identical double emission, no timing edits',()=>{
  const original=[n(60,1,.5),n(60,1.008,.505),n(64,1,.5)];
  const clone=original.map(x=>({...x}));
  const x=previewNearExactDuplicates(original);
  assert.equal(x.removed,1);
  assert.equal(x.notes.length,2);
  assert.deepEqual(x.notes,[original[0],original[2]]);
  assert.deepEqual(original,clone);
});
test('5NB never deletes real retriggers, adjacent events, or different GM instruments',()=>{
  const x=previewNearExactDuplicates([
    n(60,1,.1),n(60,1.04,.1),n(60,1.1,.1),n(60,1,.1,24),
    n(61,1,.5),n(60,1,.5)
  ]);
  assert.equal(x.removed,0);
  assert.equal(x.notes.length,6);
});
test('5NB never merges different note-off, expressive velocities, drums or pitch-bent events',()=>{
  const a={...n(60,1,.5),pitchBends:[{time:0,value:.6}]};
  const all=[n(60,1,.5),n(60,1.002,.75),n(60,1.002,.5,0,.25),
    n(42,2,.1,128),n(42,2.001,.1,128),a];
  const x=previewNearExactDuplicates(all);
  assert.equal(x.removed,0);assert.deepEqual(x.notes,all);
});
test('5NB exact dedupe improves FP without fabricating missing note',()=>{
  const reference=[r(60,1),r(64,2)];
  const notes=[n(60,1),n(60,1.006,.505),n(64,2)];
  const out=previewNearExactDuplicates(notes);
  const before=scoreAgainstReference(reference,notes);
  const after=scoreAgainstReference(reference,out.notes);
  assert.equal(before.falsePositive,1);assert.equal(after.falsePositive,0);
  assert.equal(after.truePositive,2);
  assert.equal(cleanupPreservesReference(before,after),true);
});
test('reference gate refuses candidate when a true very-close retrigger was removed',()=>{
  const refs=[r(60,1),r(60,1.009)];
  const predicted=[n(60,1),n(60,1.009)];
  const candidate=previewNearExactDuplicates(predicted);
  assert.equal(candidate.removed,1);
  const before=scoreAgainstReference(refs,predicted);
  const after=scoreAgainstReference(refs,candidate.notes);
  assert.equal(before.truePositive,2);assert.equal(after.truePositive,1);
  assert.equal(cleanupPreservesReference(before,after),false);
});
test('reference diagnostics distinguish unpaired, extra and incorrect release offsets',()=>{
 const report=diagnoseAgainstReference(
   [r(60,1,.5),r(62,2,.5),r(64,3,.7)],
   [n(60,1.03,.9),n(65,2,.5),n(64,3.04,.65)]);
 assert.equal(report.matched,2);
 assert.equal(report.missing,1);
 assert.equal(report.extra,1);
 assert.equal(report.offsetWarnings,1);
 assert.equal(report.missingExamples[0].pitchMidi,62);
 assert.equal(report.extraExamples[0].pitchMidi,65);
 assert.ok((report.offsetExamples[0].errorMs||0)>100);
});
test('diagnostic uses manual MIDI offset while preserving source inputs',()=>{
 const refs=[r(60,1)],notes=[n(60,1.2)];
 assert.equal(diagnoseAgainstReference(refs,notes).missing,1);
 assert.equal(diagnoseAgainstReference(refs,notes,.2).matched,1);
 assert.deepEqual(refs,[r(60,1)]);assert.deepEqual(notes,[n(60,1.2)]);
});
test('diagnostic gives one-to-one reference matching for duplicate events',()=>{
 const diagnosis=diagnoseAgainstReference([r(60,1)],[n(60,1),n(60,1.001)]);
 assert.deepEqual([diagnosis.matched,diagnosis.extra,diagnosis.missing],[1,1,0]);
});
test('reject invalid input or unsupported offsets, never fabricate corrections',()=>{
 assert.throws(()=>previewNearExactDuplicates([n(150,1)]),/không hợp lệ/);
 assert.throws(()=>diagnoseAgainstReference([],[n(60,-1)]),/không hợp lệ/);
 assert.throws(()=>diagnoseAgainstReference([],[],6),/giới hạn/);
});
test('large dense same-onset input remains bounded and deterministic',()=>{
 const input=Array.from({length:20000},(_,i)=>n(60,1,.5));
 const output=previewNearExactDuplicates(input);
 assert.equal(output.notes.length,1);
 assert.equal(output.removed,19999);
});
