import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const electron = readFileSync(new URL('../../desktop-preview/main.cjs', import.meta.url), 'utf8');
const cli = readFileSync(new URL('../../notiq-native/main.cpp', import.meta.url), 'utf8');

test('NOTIQ renderer only dispatches AI recognition to original NeuralNote MuScriptor', () => {
  assert.match(app, /await runMuScriptor\(target\.file/);
  assert.doesNotMatch(app, /await transcribe\(target\.file/);
  assert.doesNotMatch(app, /^import .*?\btranscribe\b.*?from ['"]\.\/audio['"]/m);
  assert.match(app, /if \(!nativeReady\)/);
});

test('Web only recognizes with original MuScriptor when a real private API is available', () => {
  assert.match(app, /installWebMuScriptorBridge/);
  assert.match(app, /Máy chủ MuScriptor thử nghiệm chưa sẵn sàng/);
  assert.match(app, /MuScriptor chưa kết nối/);
  assert.doesNotMatch(app, /AI: Basic Pitch \(Web\)/);
});

test('Windows process invokes pinned C++ MuScriptor rather than JavaScript WebGL', () => {
  assert.match(electron, /spawn\(bridgeBinary,/);
  assert.match(electron, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.match(cli, /msl::Transcriber::load/);
  assert.match(cli, /engine->transcribe/);
  assert.doesNotMatch(cli, /BasicPitch/);
});
