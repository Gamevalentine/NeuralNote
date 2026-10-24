import test from 'node:test';
import assert from 'node:assert/strict';
import toneMidi from '@tonejs/midi';
import {unzipSync} from 'fflate';
import {addPedalPoint,addPedalSpan,shiftPedalPoint,pedalDownAt,effectivePedalEvents,eventsForPedalTrack} from '../src/pedal.ts';
import {soundingDurationWithPedal} from '../src/pedalPlayback.ts';
import {extractDawTracks,createDawMidi,createDawBundle} from '../src/dawMidi.ts';
const {Midi}=toneMidi;
const note=(program=0,time=1,duration=.4)=>({pitchMidi:60,program,isDrum:program===128,
 startTimeSeconds:time,durationSeconds:duration,amplitude:.7874015748});
const tracks=(notes= [note(0),note(40)])=>extractDawTracks(notes,
  {low:0,mid:0,high:0},new Set(['high','mid','low'] as const));
const cc=(track:any)=> (track.controlChanges[64]||[]).map((x:any)=>({
 time:x.time,value:Math.round(x.value*127)
}));
test('5ND span adds bounded on/off, rejects overlapping duplicate and invalid pair',()=>{
 let events=addPedalSpan([], 'gm-0',.5,1.5);
 assert.deepEqual(events.map(e=>e.value),[127,0]);
 assert.deepEqual(events.map(e=>e.timeSeconds),[.5,1.5]);
 assert.equal(addPedalSpan(events,'gm-0',1,2),events);
 assert.equal(addPedalSpan(events,'gm-0',-1,2),events);
 assert.equal(addPedalSpan(events,'gm-0',1,1.005),events);
});
test('5ND local CC64 wins same-time global event consistently',()=>{
 const events=[
  {trackKey:'*',timeSeconds:.4,value:127 as const},
  {trackKey:'gm-0',timeSeconds:.4,value:0 as const},
  {trackKey:'gm-40',timeSeconds:.4,value:127 as const},
  {trackKey:'*',timeSeconds:1.8,value:0 as const},
 ];
 assert.equal(pedalDownAt('gm-0',events,.8),false);
 assert.equal(pedalDownAt('gm-40',events,.8),true);
 assert.deepEqual(effectivePedalEvents('gm-0',events),[]);
 const violin=effectivePedalEvents('gm-40',events);
 assert.deepEqual(violin.map(e=>e.value),[127,0]);
 assert.equal(soundingDurationWithPedal(note(0),events),.4);
 assert.ok(soundingDurationWithPedal(note(40),events)> .79);
 const exported=new Midi(createDawMidi(tracks(),120,events));
 const piano=exported.tracks.find(t=>t.instrument.number===0)!;
 const strings=exported.tracks.find(t=>t.instrument.number===40)!;
 assert.equal(cc(piano).length,0);
 assert.deepEqual(cc(strings).map(x=>x.value),[127,0]);
});
test('5ND explicit CC64 note-off is preserved while preview sustain ends at release',()=>{
 const on=addPedalSpan([], 'gm-0',.25,1.75);
 const n=note(0,.5,.5);
 assert.ok(Math.abs(soundingDurationWithPedal(n,on)-1.25)<.0001);
 const midi=new Midi(createDawMidi(tracks([n]),120,on));
 const piano=midi.tracks[0];
 assert.ok(Math.abs(piano.notes[0].duration-.5)<.002);
 assert.deepEqual(cc(piano).map(x=>x.value),[127,0]);
 assert.ok(Math.abs(cc(piano)[1].time-1.75)<.002);
});
test('5ND no automatic pedal or infinite hold, no sustain on drum',()=>{
 const notes=[note(0),note(128)];
 assert.equal(soundingDurationWithPedal(notes[0],[]),.4);
 const unclosed=[{trackKey:'*',timeSeconds:.2,value:127 as const}];
 assert.equal(soundingDurationWithPedal(notes[0],unclosed),.4);
 assert.equal(soundingDurationWithPedal(notes[1],addPedalSpan([], '*',.1,1.8)),.4);
 const midi=new Midi(createDawMidi(tracks(notes),120,unclosed));
 const melodic=midi.tracks.find(t=>t.channel!==9)!;
 const drums=midi.tracks.find(t=>t.channel===9)!;
 assert.deepEqual(cc(melodic).map(x=>x.value),[127,0]);
 assert.equal(cc(drums).length,0);
});
test('5ND event shift respects same track order and 10ms precision',()=>{
 const original=addPedalSpan([], 'gm-0',.2,1);
 const changed=shiftPedalPoint(original,1,.01);
 assert.ok(Math.abs(changed[1].timeSeconds-1.01)<.00001);
 assert.equal(original[1].timeSeconds,1);
 assert.equal(shiftPedalPoint(original,0,.9),original);
 assert.equal(shiftPedalPoint(original,1,-.8),original);
 assert.equal(shiftPedalPoint(original,1,Number.NaN),original);
 assert.equal(shiftPedalPoint(original,99,.01),original);
});
test('5ND priority at same timestamp rejects pedal phase disagreement between MIDI and preview',()=>{
 const events=[
  {trackKey:'*',timeSeconds:.1,value:127 as const},
  {trackKey:'gm-0',timeSeconds:.3,value:0 as const},
  {trackKey:'*',timeSeconds:.3,value:127 as const},
  {trackKey:'gm-0',timeSeconds:.6,value:127 as const},
  {trackKey:'*',timeSeconds:1.9,value:0 as const},
 ];
 const timeline=effectivePedalEvents('gm-0',events);
 assert.deepEqual(timeline.map(e=>[e.timeSeconds,e.value]),[[.1,127],[.3,0],[.6,127],[1.9,0]]);
 assert.ok(Math.abs(soundingDurationWithPedal(note(0,1,.4),events)-.9)<.01);
 const midi=new Midi(createDawMidi(tracks([note(0,1,.4)]),120,events));
 assert.deepEqual(cc(midi.tracks[0]).map(e=>e.value),[127,0,127,0]);
});
test('5ND Kontakt bundle emits track-scoped CC64 with no drums',()=>{
 const events=addPedalSpan([], 'gm-0',.2,1.7);
 const content=unzipSync(createDawBundle(tracks([note(0),note(40),note(128)]),120,events));
 const all=new Midi(content['NOTIQ_ALL_TRACKS.mid']);
 assert.equal(all.tracks.filter(t=>cc(t).length>0).length,1);
 const stems=Object.entries(content).filter(([p])=>p.endsWith('.mid')&&p.includes('MIDI_TRACKS/'))
  .map(([,buffer])=>new Midi(buffer).tracks[0]);
 assert.equal(stems.filter(t=>cc(t).length>0).length,1);
 assert.equal(stems.find(t=>t.channel===9)!.controlChanges[64]?.length||0,0);
});
test('5ND handles 70000-note timeline without stack spread error',()=>{
 const large={key:'gm-0',isDrum:false,notes:Array.from({length:70000},(_,i)=>({
  startTimeSeconds:i/100,durationSeconds:.25
 }))};
 const output=eventsForPedalTrack(large,addPedalSpan([], 'gm-0',.1,5));
 assert.deepEqual(output.map(e=>e.value),[127,0]);
});
