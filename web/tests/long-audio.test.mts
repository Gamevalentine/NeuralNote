import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSupportedSong, CHUNK_CORE_SECONDS, CHUNK_CONTEXT_SECONDS,
  MAX_SONG_BYTES, MAX_SONG_SECONDS, collectChunkNotes, mergeChunkNotes, planSongChunks } from '../src/longAudio.ts';

test('full 4min 21s song is divided into bounded inference windows, not rejected at 45 seconds', () => {
  const chunks = planSongChunks(261);
  assert.equal(chunks.length, 11);
  assert.equal(CHUNK_CORE_SECONDS, 25);
  assert.equal(CHUNK_CONTEXT_SECONDS, 2);
  assert.equal(chunks[0].coreStart, 0);
  assert.equal(chunks[0].coreEnd, 25);
  assert.equal(chunks[1].renderStart, 23);
  assert.equal(chunks[1].renderEnd, 52);
  assert.equal(chunks.at(-1)?.coreEnd, 261);
  assert.ok(chunks.every(chunk => chunk.renderEnd - chunk.renderStart <= 29));
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.coreEnd - chunk.coreStart, 0), 261);
});

test('supported 15 minutes and upload size are documented; >15 min is rejected clearly', () => {
  assert.equal(MAX_SONG_SECONDS, 900);
  assert.equal(MAX_SONG_BYTES, 200 * 1024 * 1024);
  assert.doesNotThrow(() => assertSupportedSong(900));
  assert.throws(() => assertSupportedSong(900.1), /15 phút/);
  assert.throws(() => assertSupportedSong(0), /không có thời lượng hợp lệ/);
});

test('overlapping inference context does not duplicate notes and keeps original global onset', () => {
  const [a,b] = planSongChunks(65);
  const left = collectChunkNotes(a, [
    {pitchMidi:60,startTimeSeconds:24.88,durationSeconds:0.6},
    {pitchMidi:62,startTimeSeconds:25.15,durationSeconds:0.5},
  ]);
  const right = collectChunkNotes(b, [
    {pitchMidi:60,startTimeSeconds:1.88,durationSeconds:0.6}, // global 24.88: not owned by b
    {pitchMidi:62,startTimeSeconds:2.15,durationSeconds:0.5}, // global 25.15: owned by b
  ]);
  assert.deepEqual(left.map(note => note.pitchMidi), [60]);
  assert.deepEqual(right.map(note => note.pitchMidi), [62]);
  assert.equal(right[0].startTimeSeconds, 25.15);
  const result = mergeChunkNotes([...left,...right]);
  assert.equal(result.length, 2);
  assert.ok(result[0].startTimeSeconds < result[1].startTimeSeconds);
});

test('merge suppresses near-duplicates without removing legitimate 16th-note repeats', () => {
  const result = mergeChunkNotes([
    { pitchMidi:64,startTimeSeconds:25.01,durationSeconds:0.4 },
    { pitchMidi:64,startTimeSeconds:25.03,durationSeconds:0.42 },
    { pitchMidi:64,startTimeSeconds:25.135,durationSeconds:0.4 },
  ]);
  assert.equal(result.length, 2);
});
