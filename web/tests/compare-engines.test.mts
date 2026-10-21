import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareEngines,ONSET_TOLERANCE_SECONDS} from '../src/compareEngines.ts';
const note=(pitchMidi:number,startTimeSeconds:number,durationSeconds=0.5)=>({
 pitchMidi,startTimeSeconds,durationSeconds,amplitude:0.7,program:0,isDrum:false
});
const compare=(a:ReturnType<typeof note>[],b:ReturnType<typeof note>[])=>compareEngines(
 {engine:'muscriptor',notes:a,pedalEvents:[]},
 {engine:'transkun-v2',notes:b,pedalEvents:[]}
);
test('one-to-one same pitch with <=100ms onset tolerance',()=>{
 const result=compare([note(60,1),note(60,1.6)],[note(60,1.07),note(60,1.61)]);
 assert.equal(ONSET_TOLERANCE_SECONDS,0.1);
 assert.equal(result.pairs.length,2);
 assert.equal(result.meanAbsOnsetDifferenceMs,40);
 assert.deepEqual([result.muscriptorOnly.length,result.transkunOnly.length],[0,0]);
});
test('different pitches, 110ms late notes or duplicate onset remain disagreements',()=>{
 const result=compare([note(60,1),note(60,1.0),note(62,2)],[
  note(61,1),note(60,1.11),note(62,2.01)
 ]);
 assert.equal(result.pairs.length,1);
 assert.equal(result.muscriptorOnly.length,2);
 assert.equal(result.transkunOnly.length,2);
});
test('matching duration deviations separately, not as fabricated incorrect notes',()=>{
 const result=compare([note(60,3,1)],[note(60,3.03,0.7)]);
 assert.equal(result.pairs.length,1);
 assert.equal(result.pairs[0].durationDifferenceMs,-300);
 assert.equal(result.meanAbsDurationDifferenceMs,300);
});
test('matching always preserves untouched source arrays and pedal events',()=>{
 const a={engine:'muscriptor' as const,notes:[note(60,0.5)],pedalEvents:[]};
 const b={engine:'transkun-v2' as const,notes:[note(60,0.51)],
   pedalEvents:[{trackKey:'gm-0',timeSeconds:0.5,value:127 as const}]};
 const old=JSON.stringify({a,b});
 const result=compareEngines(a,b);
 assert.equal(result.transkun.pedalEvents.length,1);
 assert.equal(JSON.stringify({a,b}),old);
});
test('deterministic with retrigger duplicates and unsorted notes',()=>{
 const r=compare([note(64,1.45),note(64,1),note(64,1.1)],
                 [note(64,1.09),note(64,1.44),note(64,1.01)]);
 assert.equal(r.pairs.length,3);
 assert.equal(r.meanAbsOnsetDifferenceMs,10);
});
test('invalid pitches/tolerances rejected',()=>{
 assert.throws(()=>compare([note(-1,1)],[]),/không hợp lệ/);
 assert.throws(()=>compareEngines({engine:'transkun-v2',notes:[],pedalEvents:[]},
  {engine:'muscriptor',notes:[],pedalEvents:[]}),/Sai thứ tự/);
});
