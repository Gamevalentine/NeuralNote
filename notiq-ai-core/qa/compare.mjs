// Stage 3 real audio QA. Strictly compares actual native MuScriptor vs actual
// Emscripten WASM. Never generates notes or substitutes mock results.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const [nativePath, wasmPath, midiPath] = process.argv.slice(2);
if (!nativePath || !wasmPath || !midiPath) throw Error('Usage: compare.mjs native.json wasm.json recognized.mid');
const native = JSON.parse(readFileSync(nativePath,'utf8'));
const wasm = JSON.parse(readFileSync(wasmPath,'utf8'));
const midi = readFileSync(midiPath);
function validate(data,name) {
  assert.equal(data.schema,1,name+' schema');
  assert.equal(data.engine,'muscriptor',name+' engine');
  assert.ok(Array.isArray(data.notes) && data.notes.length > 0,name+' must contain REAL notes');
  assert.ok(data.notes.every(n =>
    n.pitchMidi>=0 && n.pitchMidi<=127 && Number.isInteger(n.pitchMidi) &&
    Number.isFinite(n.startTimeSeconds) && n.startTimeSeconds>=0 &&
    Number.isFinite(n.durationSeconds) && n.durationSeconds>0 &&
    Number.isInteger(n.program) && n.program>=0 && n.program<=128 &&
    typeof n.isDrum === 'boolean'),name+' note schema');
}
validate(native,'native');
validate(wasm,'WASM');
const N=native.notes,W=wasm.notes,used=new Set();
const comparisons=[];
for (const w of W) {
  let best=-1, distance=Infinity;
  for (let i=0;i<N.length;i++) {
    if (used.has(i)) continue;
    const n=N[i];
    // Native bridge preserves MuScriptor original percussion program.
    const nativeProgram=n.isDrum ? 128 : n.program;
    if (w.pitchMidi !== n.pitchMidi || w.isDrum !== n.isDrum ||
        w.program !== nativeProgram) continue;
    const onset=Math.abs(w.startTimeSeconds-n.startTimeSeconds);
    const duration=Math.abs(w.durationSeconds-n.durationSeconds);
    const dist=onset+duration;
    if(onset<=0.15 && duration<=0.2 && dist<distance){best=i;distance=dist;}
  }
  if(best>=0){used.add(best);comparisons.push(distance);}
}
const precision = comparisons.length / Math.max(N.length,W.length);
const countRatio = Math.min(N.length,W.length)/Math.max(N.length,W.length);
const summary={
  fixture:'Jon Worthy and the Bends - You Drive Me Insane (first 15 sec), CC BY 4.0',
  nativeNotes:N.length, wasmNotes:W.length,matchedNotes:comparisons.length,
  matchingRatio:Number(precision.toFixed(4)),countRatio:Number(countRatio.toFixed(4)),
  maxMatchedCombinedTimingDeviationSeconds:comparisons.length?Number(Math.max(...comparisons).toFixed(4)):null,
  midiBytes:midi.length, comparator:'same pitch, instrument and drum flag; onset <=0.15s, duration <=0.2s',
};
console.log('NOTIQ_REAL_AUDIO_COMPARISON:',JSON.stringify(summary));
assert.ok(midi.length > 40,'MIDI must not be empty');
assert.equal(midi.toString('ascii',0,4),'MThd');
assert.equal(midi.readUInt32BE(4),6);
assert.equal(midi.readUInt16BE(8),1,'MIDI type 1');
assert.equal(midi.readUInt16BE(12),480,'MIDI PPQ 480');
assert.ok(countRatio>=0.85,'WASM and native note counts differ >15%');
assert.ok(precision>=0.80,'WASM fails the note/pitch/onset/duration comparison acceptance gate');
const summaryPath = wasmPath.replace(/\.json$/,'-qa-summary.json');
writeFileSync(summaryPath,JSON.stringify({...summary,passed:true},null,2)+'\n');
console.log('NOTIQ_STAGE3_REAL_WAV_PASS');
