// Fail-closed preflight: a local developer/runner can check readiness without
// downloading anything, spending GitHub Actions quota, or creating fake WASM.
import { spawnSync } from 'node:child_process';

function probe(executable, args) {
  const run = spawnSync(executable, args, { encoding: 'utf8', timeout: 15_000 });
  if (run.error || run.status !== 0)
    return { present: false, diagnostic: String(run.error?.message || run.stderr || 'not available').trim() };
  return { present: true, version: (run.stdout || run.stderr || '').split('\n')[0].trim() };
}
const tools = {
  cmake: probe('cmake', ['--version']),
  ninja: probe('ninja', ['--version']),
  emcc: probe('emcc', ['--version']),
  emcmake: probe('emcmake', ['cmake', '--version']),
  python3: probe('python3', ['--version']),
};
const missing = Object.entries(tools).filter(([, result]) => !result.present).map(([name]) => name);
console.log(JSON.stringify({
  check: 'NOTIQ AI Core WebAssembly toolchain',
  ready: missing.length === 0,
  missing, tools,
  next: missing.length ? 'Real MuScriptor WASM compilation is blocked until these tools exist.' :
    'Toolchain detected; this does not prove MuScriptor/ggml compile or GGUF inference.',
}, null, 2));
if (missing.length) process.exitCode = 2;
