import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewOverlapCleanup} from '../src/noteQuality.ts';
import {soundingDurationWithPedal} from '../src/pedalPlayback.ts';
const note=(pitchMidi:number,startTimeSeconds:number,durationSeconds:number,program=0,amplitude=.6)=>({
 pitchMidi,startTimeSeconds,durationSeconds,program,isDrum:program===128,amplitude
});
test('overlap removes exactly one retrigger, extends end and preserves loudest velocity',()=>{
 const raw=[note(60,1,1,0,.5),note(60,1.8,1,0,.9)];
 const p=previewOverlapCleanup(raw);
 assert.equal(p.merged,1);assert.equal(p.notes.length,1);
 assert.ok(Math.abs(p.notes[0].durationSeconds-1.8)<1e-8);
 assert.equal(p.notes[0].amplitude,.9);
 assert.equal(raw.length,2);assert.equal(raw[0].durationSeconds,1);
});
test('real adjacent repeated note stays and same pitch across different programs stays',()=>{
 const p=previewOverlapCleanup([note(60,1,1,0),note(60,2,1,0),note(60,1.2,1,24)]);
 assert.equal(p.merged,0);assert.equal(p.notes.length,3);
});
test('nested overlap chain merges to last end; drums are untouched',()=>{
 const a=[note(60,1,2),note(60,1.3,.2),note(60,2.8,.5),note(42,1,.8,128),note(42,1.1,.5,128)];
 const p=previewOverlapCleanup(a);
 assert.equal(p.merged,2);assert.equal(p.notes.length,3);
 assert.ok(Math.abs(p.notes.find(n=>n.pitchMidi===60)!.durationSeconds-2.3)<1e-8);
 assert.equal(p.notes.filter(n=>n.isDrum).length,2);
});
test('sustain extends sample from note-off to CC64 release, MIDI note duration untouched',()=>{
 const n=note(60,1,.5);
 const pedal=[{trackKey:'gm-0',timeSeconds:.4,value:127 as const},
  {trackKey:'gm-0',timeSeconds:2.7,value:0 as const}];
 assert.ok(Math.abs(soundingDurationWithPedal(n,pedal)-1.7)<1e-8);
 assert.equal(n.durationSeconds,.5);
});
test('unrelated track or pedal-down only after note-off cannot stretch audio',()=>{
 const n=note(60,1,.5);
 assert.equal(soundingDurationWithPedal(n,[{trackKey:'gm-24',timeSeconds:0,value:127},{trackKey:'gm-24',timeSeconds:5,value:0}]),.5);
 assert.equal(soundingDurationWithPedal(n,[{trackKey:'gm-0',timeSeconds:1.7,value:127},{trackKey:'gm-0',timeSeconds:4,value:0}]),.5);
});
test('track-specific pedal beats simultaneous global CC64, no release cannot fake sustain',()=>{
 const n=note(60,1,.5);
 assert.equal(soundingDurationWithPedal(n,[
 {trackKey:'*',timeSeconds:0,value:127},{trackKey:'gm-0',timeSeconds:0,value:0},
 {trackKey:'*',timeSeconds:3,value:0}
 ]),.5);
 assert.equal(soundingDurationWithPedal(n,[{trackKey:'*',timeSeconds:0,value:127}]),.5);
});
test('sustained samples have max 8-second cap and drums stay short',()=>{
 const n=note(60,1,.5);
 assert.equal(soundingDurationWithPedal(n,[{trackKey:'*',timeSeconds:0,value:127},{trackKey:'*',timeSeconds:50,value:0}]),8);
 assert.equal(soundingDurationWithPedal(note(42,1,.2,128),[{trackKey:'*',timeSeconds:0,value:127},{trackKey:'*',timeSeconds:5,value:0}]),.2);
});
