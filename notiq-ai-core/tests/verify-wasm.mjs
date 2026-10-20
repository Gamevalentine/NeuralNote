// Stage 2: independently validate real Emscripten output. No fake WASM,
// no inference claim, no paid service or GitHub Actions required.
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dirname = fileURLToPath(new URL('.', import.meta.url));
const build = resolve(dirname, '../.build-wasm');
const jsPath = resolve(build, 'notiq-ai-core.js');
const wasmPath = resolve(build, 'notiq-ai-core.wasm');
const needed = [
  'notiq_core_load_model', 'notiq_core_transcribe', 'notiq_core_progress',
  'notiq_core_error', 'notiq_core_result_json', 'notiq_core_unload',
  'malloc', 'free',
];
try {
  const [js, wasm, size] = await Promise.all([
    readFile(jsPath, 'utf8'),
    readFile(wasmPath),
    stat(wasmPath),
  ]);
  if (!js.includes('WebAssembly') && !js.includes('.wasm'))
    throw new Error('No Emscripten JS/WASM loader detected');
  if (size.size < 1024)
    throw new Error('WASM is too small to contain the MuScriptor engine');
  if (wasm.subarray(0, 4).toString('hex') !== '0061736d')
    throw new Error('Invalid WebAssembly magic header');
  if (!WebAssembly.validate(wasm))
    throw new Error('WASM cannot be validated by the current JS runtime');
  const module = await WebAssembly.compile(wasm);
  const exported = WebAssembly.Module.exports(module).map(item => item.name);
  const missing = needed.filter(name =>
    !exported.some(entry => entry === name || entry === '_' + name));
  if (missing.length)
    throw new Error('Missing required NOTIQ AI Core exports: ' + missing.join(', '));
  console.log(JSON.stringify({
    stage: 'wasm-binary', passed: true, bytes: size.size,
    exports: needed, note: 'This is binary validation, NOT real GGUF inference.',
  }));
} catch (error) {
  console.error('NOTIQ WASM Stage 2 NOT VERIFIED: ' + (error?.message || error));
  process.exitCode = 1;
}
