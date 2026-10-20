// Optional startup download, copied from the pinned model descriptor used in NOTIQ Desktop.
// Never store model weights inside GitHub or a public artifact.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createNotiqServer } from './server.mjs';

const model = Object.freeze({
  bytes: 209425152,
  sha256: '925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4',
  url: 'https://huggingface.co/DamRsn/muscriptor-gguf/resolve/d7045f94e8b19427f4ff9542975035e66596e51c/v1/muscriptor-small-f16.gguf',
});
async function modelReady(path) {
  try { return (await stat(path)).size === model.bytes; } catch { return false; }
}
async function downloadModel(path) {
  if (await modelReady(path)) return;
  await mkdir(dirname(path), { recursive: true });
  const part = path + '.part';
  try {
    const response = await fetch(model.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);
    let received = 0;
    const digest = createHash('sha256');
    const check = new Transform({
      transform(chunk, _encoding, cb) {
        received += chunk.length;
        if (received > model.bytes) { cb(new Error('Trọng số GGUF lớn hơn dự kiến')); return; }
        digest.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), check, createWriteStream(part));
    if (received !== model.bytes || digest.digest('hex') !== model.sha256)
      throw new Error('GGUF không khớp checksum đã ghim');
    await rename(part, path);
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}
const path = process.env.NOTIQ_MODEL_PATH;
if (!path) throw new Error('NOTIQ_MODEL_PATH is required');
if (process.env.NOTIQ_MODEL_DOWNLOAD === '1') {
  console.log('Preparing pinned MuScriptor Small model for private preview');
  await downloadModel(path);
}
if (!existsSync(path)) throw new Error('GGUF model is missing; set NOTIQ_MODEL_DOWNLOAD=1 to opt in to downloading it.');

// Optional *real* inference smoke test, NOT mock: the original upstream
// CC BY 4.0, 15-second WAV fixture is decoded by the unchanged C++ bridge.
async function realInferenceSmokeTest() {
  const binary = process.env.NOTIQ_CLI_PATH;
  const fixture = process.env.NOTIQ_SMOKE_WAV_PATH;
  const marker = process.env.NOTIQ_SMOKE_MARKER;
  if (!binary || !fixture || !existsSync(binary) || !existsSync(fixture))
    throw new Error('MuScriptor real smoke test requires native CLI and 16kHz WAV fixture.');
  if (marker && existsSync(marker)) {
    console.log('Previously verified C++ fixture inference on this Codespace.');
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'notiq-real-smoke-'));
  try {
    const result = join(dir, 'notes.json');
    console.log('Starting REAL MuScriptor inference on 15-second licensed WAV fixture...');
    await new Promise((resolve, reject) => {
      const child = spawn(binary, [fixture, path, result], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let tail = '';
      const timeout = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
      child.stderr.on('data', chunk => {
        tail = (tail + String(chunk)).slice(-800);
        const recent = [...String(chunk).matchAll(/PROGRESS\\s+(\\d+)/g)];
        if (recent.length) console.log('Native fixture inference: ' + recent.at(-1)[1] + '%');
      });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error('Native inference failed: ' + String(code) + '; ' + tail));
      });
    });
    const decoded = JSON.parse(await readFile(result, 'utf8'));
    if (decoded.schema !== 1 || decoded.engine !== 'muscriptor' ||
        !Array.isArray(decoded.notes) || decoded.notes.length === 0)
      throw new Error('Native inference produced no valid notes on the audio fixture.');
    console.log('REAL MuScriptor Audio→MIDI smoke test PASS; notes=' + decoded.notes.length);
    if (marker) await writeFile(marker, 'MuScriptor CLI real fixture pass; notes=' + decoded.notes.length + '\\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
if (process.env.NOTIQ_SMOKE_TEST === '1') await realInferenceSmokeTest();
const server = createNotiqServer();
server.listen(Number(process.env.PORT || 8080), process.env.NOTIQ_BIND_ADDRESS || '0.0.0.0', () => {
  console.log('NOTIQ MuScriptor private preview backend ready');
});
