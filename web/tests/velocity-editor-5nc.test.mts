import test from 'node:test';
import assert from 'node:assert/strict';
import toneMidi from '@tonejs/midi';
import {midiVelocity,velocityAmplitude,setNoteVelocity,nudgeNoteVelocity,velocityGain,notePreviewVolume} from '../src/velocityEditor.ts';
import {extractDawTracks,createDawMidi,createDawBundle} from '../src/dawMidi.ts';
import {unzipSync} from 'fflate';
const {Midi}=toneMidi;
const note=(amplitude:number,pitchMidi=60,program=0)=>({
 pitchMidi,startTimeSeconds:1.037,durationSeconds:.539,amplitude,
 program,isDrum:false
});
const groups=new Set(['high','mid','low'] as const),programs={high:0,mid:0,low:0};
test('5NC handles 1..127 MIDI velocity, normalized amplitude and out-of-range clamps',()=>{
 assert.equal(midiVelocity(note(100/127)),100);
 assert.equal(midiVelocity(note(0)),1);
 assert.equal(midiVelocity(note(1)),127);
 assert.equal(midiVelocity(note(Number.NaN)),100);
 assert.equal(velocityAmplitude(0),1/127);
 assert.equal(velocityAmplitude(200),1);
 assert.equal(velocityAmplitude(100),100/127);
 assert.throws(()=>velocityAmplitude(Number.NaN),/hợp lệ/);
});
test('5NC edits only selected velocity; leaves timings pitch programs and input immutable',()=>{
 const notes=[note(100/127,60,0),note(.3,72,41)];
 const snapshot=structuredClone(notes);
 const result=setNoteVelocity(notes,0,39);
 assert.equal(midiVelocity(result[0]),39);
 assert.equal(midiVelocity(result[1]),midiVelocity(notes[1]));
 assert.equal(result[0].pitchMidi,notes[0].pitchMidi);
 assert.equal(result[0].startTimeSeconds,notes[0].startTimeSeconds);
 assert.equal(result[0].durationSeconds,notes[0].durationSeconds);
 assert.equal(result[0].program,notes[0].program);
 assert.deepEqual(notes,snapshot);
 assert.notEqual(result,notes);
 assert.equal(setNoteVelocity(result,0,39),result);
});
test('5NC rejects invalid index or velocity; fine nudges clamp safely',()=>{
 const notes=[note(100/127)];
 assert.equal(setNoteVelocity(notes,1,99),notes);
 assert.equal(setNoteVelocity(notes,-1,99),notes);
 assert.equal(setNoteVelocity(notes,0,Number.NaN),notes);
 assert.equal(nudgeNoteVelocity(notes,0,99),notes);
 assert.equal(midiVelocity(nudgeNoteVelocity(notes,0,5)[0]),105);
 assert.equal(midiVelocity(nudgeNoteVelocity(notes,0,-5)[0]),95);
 assert.equal(midiVelocity(nudgeNoteVelocity([note(1)],0,5)[0]),127);
 assert.equal(midiVelocity(nudgeNoteVelocity([note(1/127)],0,-5)[0]),1);
});
test('5NC audible volume tracks the entire MIDI velocity range, default stays unchanged',()=>{
 const quiet=note(velocityAmplitude(1)),normal=note(velocityAmplitude(100)),
 loud=note(velocityAmplitude(127));
 assert.equal(velocityGain(normal),1);
 assert.equal(velocityGain(quiet),.01);
 assert.equal(velocityGain(loud),1.27);
 assert.ok(notePreviewVolume(quiet,.65,.7)<notePreviewVolume(normal,.65,.7));
 assert.ok(notePreviewVolume(loud,.65,.7)>notePreviewVolume(normal,.65,.7));
 assert.ok(notePreviewVolume(loud,1,1)>1); // caller/soundfont limits absolute gain to 1
 assert.equal(notePreviewVolume(normal,0,.8),0);
});
test('5NC exports edited velocity in real MIDI Type 1 and Kontakt stems with unchanged notes',()=>{
 const input=[note(velocityAmplitude(100),60,0),{...note(velocityAmplitude(110),64,41),startTimeSeconds:1.539}];
 const edited=setNoteVelocity(input,0,23);
 const tracks=extractDawTracks(edited,programs,groups);
 const midi=new Midi(createDawMidi(tracks,120));
 assert.equal(midi.tracks.length,2);
 const piano=midi.tracks.find(t=>t.instrument.number===0);
 const violin=midi.tracks.find(t=>t.instrument.number===41);
 assert.ok(piano);assert.ok(violin);
 assert.ok(Math.abs(piano.notes[0].velocity-23/127)<.008);
 assert.ok(Math.abs(violin.notes[0].velocity-110/127)<.008);
 assert.ok(Math.abs(piano.notes[0].time-input[0].startTimeSeconds)<.003);
 assert.ok(Math.abs(piano.notes[0].duration-input[0].durationSeconds)<.003);
 const archive=unzipSync(createDawBundle(tracks,120));
 const stems=Object.entries(archive).filter(([name])=>name.endsWith('.mid')&&name.includes('MIDI_TRACKS/'));
 assert.equal(stems.length,2);
 const pianoStem=stems.map(([,bytes])=>new Midi(bytes)).flatMap(m=>m.tracks).find(t=>t.instrument.number===0);
 assert.ok(pianoStem);
 assert.ok(Math.abs(pianoStem.notes[0].velocity-23/127)<.008);
 assert.equal(input[0].amplitude,100/127);
});
