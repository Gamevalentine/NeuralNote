// Optional startup download, copied from the pinned model descriptor used in NOTIQ Desktop.
// Never store model weights inside GitHub or a public artifact.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
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
const server = createNotiqServer();
server.listen(Number(process.env.PORT || 8080), process.env.NOTIQ_BIND_ADDRESS || '0.0.0.0', () => {
  console.log('NOTIQ MuScriptor private preview backend ready');
});
