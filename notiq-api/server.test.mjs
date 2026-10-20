import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNotiqServer, MAX_UPLOAD_BYTES } from './server.mjs';

const origin = 'https://notiq-preview.pages.dev';
const accessKey = 'private-test-key-not-for-deployment-123456';

async function fixture(t, runner) {
  const dir = await mkdtemp(join(tmpdir(), 'notiq-api-test-'));
  const model = join(dir, 'model.gguf'), cli = join(dir, 'engine');
  await writeFile(model, 'TEST_ONLY');
  await writeFile(cli, 'TEST_ONLY');
  const server = createNotiqServer({
    key: accessKey, allowedOrigin: origin, model, cli, spawnCli: runner,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return 'http://127.0.0.1:' + server.address().port;
}
const note = { startTimeSeconds: 0.5, durationSeconds: 0.25, pitchMidi: 60, program: 0,
  isDrum: false, amplitude: 0.8 };
const actualFakeRunner = (_cmd, paths) => {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(async () => {
    await writeFile(paths[2], JSON.stringify({ schema: 1, engine: 'muscriptor', notes: [note] }));
    child.stderr.emit('data', 'PROGRESS 27\nPROGRESS 83\n');
    child.emit('close', 0);
  });
  return child;
};
test('private API: authorized WAV upload runs the injected test runner and returns result', async t => {
  const url = await fixture(t, actualFakeRunner);
  const health = await (await fetch(url + '/api/health', { headers: { origin } })).json();
  assert.equal(health.available, true);
  const wav = Buffer.alloc(44); wav.write('RIFF', 0);
  const upload = await fetch(url + '/api/jobs', {
    method: 'POST', headers: { origin, 'x-notiq-key': accessKey, 'content-type': 'audio/wav' }, body: wav,
  });
  assert.equal(upload.status, 202);
  const { id } = await upload.json();
  let result;
  for (let i = 0; i < 40; i++) {
    const poll = await fetch(url + '/api/jobs/' + id, { headers: { origin, 'x-notiq-key': accessKey } });
    result = await poll.json();
    if (result.state === 'complete') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.state, 'complete');
  assert.equal(result.progress, 100);
  assert.deepEqual(result.result.notes, [note]);
});
test('private API rejects missing key, wrong origin, wrong type, oversized audio', async t => {
  const url = await fixture(t, actualFakeRunner);
  const headers = { origin, 'content-type': 'audio/wav' };
  const wav = Buffer.alloc(44);
  assert.equal((await fetch(url + '/api/jobs', { method: 'POST', headers, body: wav })).status, 403);
  assert.equal((await fetch(url + '/api/jobs', { method: 'POST',
    headers: { ...headers, origin: 'https://malicious.invalid', 'x-notiq-key': accessKey },
    body: wav })).status, 403);
  assert.equal((await fetch(url + '/api/jobs', { method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', 'x-notiq-key': accessKey },
    body: wav })).status, 413);
  assert.ok(MAX_UPLOAD_BYTES > 15 * 60 * 16000 * 4);
  assert.equal((await fetch(url + '/api/jobs', { method: 'POST',
    headers: { ...headers, 'content-length': String(MAX_UPLOAD_BYTES + 1), 'x-notiq-key': accessKey },
    body: wav })).status, 413);
});