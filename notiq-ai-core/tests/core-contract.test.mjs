// Static contract checks. These DO NOT mean Emscripten compiled or AI ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cpp = readFileSync(new URL('../src/notiq_core.cpp', import.meta.url), 'utf8');
const wasm = readFileSync(new URL('../CMakeLists.txt', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../web/worker.mjs', import.meta.url), 'utf8');
const copy = readFileSync(new URL('../scripts/snapshot_source.py', import.meta.url), 'utf8');

test('NOTIQ AI Core calls upstream real MuScriptor model and inference', () => {
  assert.match(cpp, /msl::Transcriber::load\(/);
  assert.match(cpp, /engine->transcribe\(/);
  assert.match(cpp, /notiq_core_result_json/);
  assert.match(cpp, /notiq_core_unload/);
  assert.match(cpp, /notiq_emit_progress/);
  assert.match(cpp, /midiProgram = note.is_drum \? 128 : note.program/);
});
test('NOTIQ snapshot copies pinned C++ source and retains license', () => {
  assert.match(copy, /copytree\(source \/ "cpp"/);
  assert.match(copy, /copy2\(source \/ "LICENSE"/);
  assert.match(copy, /SOURCE_REVISION/);
});
test('NOTIQ browser worker is offline, requires actual model and engine', () => {
  assert.match(worker, /model instanceof ArrayBuffer/);
  assert.match(worker, /_notiq_core_load_model/);
  assert.match(worker, /_notiq_core_transcribe/);
  assert.match(worker, /SMALL_MODEL_SHA256/);
  assert.match(worker, /crypto.subtle.digest\('SHA-256'/);
  assert.match(worker, /engine.FS.unlink\(memoryPath\)/);
  assert.match(worker, /same website|cùng website/);
  assert.doesNotMatch(worker, /\bfetch\(/);
  assert.doesNotMatch(worker, /BasicPitch/);
  assert.match(wasm, /if\(NOT EMSCRIPTEN\)/);
  assert.match(wasm, /MUSCRIPTOR_VULKAN OFF/);
  assert.match(wasm, /-sALLOW_MEMORY_GROWTH=1/);
});
