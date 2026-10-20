// Private NOTIQ MuScriptor API. All inference is performed by the existing C++ CLI.
// No permanent audio storage and no simulated recognition results.
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';

export const MAX_UPLOAD_BYTES = 15 * 60 * 16000 * 4 + 4096;
const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_RUNTIME_MS = 45 * 60 * 1000;

export function createNotiqServer({
  key = process.env.NOTIQ_API_KEY,
  allowedOrigin = process.env.NOTIQ_ALLOWED_ORIGIN,
  model = process.env.NOTIQ_MODEL_PATH,
  cli = process.env.NOTIQ_CLI_PATH,
  spawnCli = spawn,
} = {}) {
  if (!key || key.length < 24) throw new Error('NOTIQ_API_KEY must be a private random value (24+ characters).');
  if (!allowedOrigin || !/^https:\/\/[^/]+$/.test(allowedOrigin) &&
      !/^http:\/\/localhost(?::\d+)?$/.test(allowedOrigin))
    throw new Error('NOTIQ_ALLOWED_ORIGIN must be a single HTTPS origin or localhost.');
  if (!cli || !model) throw new Error('Set NOTIQ_CLI_PATH and NOTIQ_MODEL_PATH.');
  const jobs = new Map();
  let active = null;
  const ready = () => existsSync(cli) && existsSync(model);
  function send(res, code, payload) {
    if (res.headersSent) return;
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(payload));
  }
  function authorized(req) {
    const candidate = req.headers['x-notiq-key'];
    if (typeof candidate !== 'string') return false;
    const supplied = Buffer.from(candidate), expected = Buffer.from(key);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  function inspectJob(job) {
    return { id: job.id, state: job.state, progress: job.progress,
      message: job.message, ...(job.state === 'complete' ? { result: job.result } : {}),
      ...(job.state === 'error' ? { error: job.error } : {}) };
  }
  function discardExpired() {
    for (const [id, job] of jobs)
      if (job.state !== 'running' && Date.now() - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
  async function infer(job) {
    job.state = 'running';
    job.message = 'Đang chạy MuScriptor thật trên máy chủ thử nghiệm';
    const output = join(job.dir, 'result.json');
    try {
      await new Promise((ok, fail) => {
        const child = spawnCli(cli, [job.wav, model, output], {
          shell: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, cwd: job.dir,
        });
        job.child = child;
        let diagnostic = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, MAX_RUNTIME_MS);
        child.stderr?.on('data', chunk => {
          const chunkText = String(chunk);
          diagnostic = (diagnostic + chunkText).slice(-2048);
          for (const match of chunkText.matchAll(/PROGRESS\s+(\d{1,3})/g)) {
            job.progress = Math.min(98, Math.max(job.progress, Math.min(98, Number(match[1]))));
            job.message = job.progress < 20 ? 'MuScriptor đang tải mô hình'
              : 'MuScriptor đang nhận diện nốt và nhạc cụ';
            job.updatedAt = Date.now();
          }
        });
        child.once('error', fail);
        child.once('close', code => {
          clearTimeout(timer);
          if (code === 0) ok();
          else fail(new Error(/SIGKILL|timed out/i.test(diagnostic)
            ? 'Quá thời gian xử lý' : 'MuScriptor lỗi hoặc bị dừng (exit ' + code + ')'));
        });
      });
      const size = (await stat(output)).size;
      if (size < 20 || size > 32 * 1024 * 1024) throw new Error('Kết quả AI không hợp lệ');
      const result = JSON.parse(await readFile(output, 'utf8'));
      if (result?.engine !== 'muscriptor' || result.schema !== 1 || !Array.isArray(result.notes) ||
          result.notes.length > 150_000) throw new Error('Sai định dạng kết quả MuScriptor');
      job.result = result;
      job.progress = 100;
      job.state = 'complete';
      job.message = 'Nhận diện hoàn tất';
    } catch (error) {
      job.state = 'error';
      job.error = 'Không thể nhận diện bằng MuScriptor. ' +
        (error instanceof Error ? error.message : 'Lỗi không rõ nguyên nhân');
      job.message = 'Nhận diện thất bại';
    } finally {
      job.updatedAt = Date.now();
      job.child = null;
      if (active === job) active = null;
      await rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  const server = createServer(async (req, res) => {
    discardExpired();
    const origin = req.headers.origin;
    if (origin === allowedOrigin) {
      res.setHeader('access-control-allow-origin', allowedOrigin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type,x-notiq-key');
      res.setHeader('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') {
      if (origin !== allowedOrigin) { send(res, 403, { error: 'Origin không được phép' }); return; }
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      send(res, 200, { engine: 'muscriptor', available: ready(), modelInstalled: existsSync(model),
        busy: !!active }); return;
    }
    if (origin !== allowedOrigin || !authorized(req)) {
      send(res, 403, { error: 'Không có quyền truy cập máy chủ NOTIQ' }); return;
    }
    if (req.method === 'POST' && req.url === '/api/jobs') {
      if (!ready()) { send(res, 503, { error: 'Máy chủ chưa có MuScriptor/model' }); return; }
      if (active) { send(res, 429, { error: 'Máy chủ đang nhận diện bài khác; vui lòng thử lại' }); return; }
      const bytes = Number(req.headers['content-length']);
      if (req.headers['content-type']?.split(';')[0] !== 'audio/wav' ||
          !Number.isSafeInteger(bytes) || bytes < 44 || bytes > MAX_UPLOAD_BYTES) {
        send(res, 413, { error: 'Chỉ nhận WAV mono 16 kHz, tối đa 15 phút' }); return;
      }
      const job = { id: randomUUID(), state: 'uploading', progress: 0,
        message: 'Đang nhận dữ liệu âm thanh', updatedAt: Date.now(),
        dir: null, wav: null, child: null, result: null };
      active = job;
      try {
        job.dir = await mkdtemp(join(tmpdir(), 'notiq-api-'));
        job.wav = join(job.dir, 'input.wav');
        let total = 0;
        const limiter = new Transform({
          transform(chunk, encoding, cb) {
            total += chunk.length;
            cb(total > MAX_UPLOAD_BYTES ? new Error('Tệp quá lớn') : null, chunk);
          },
        });
        await pipeline(req, limiter, createWriteStream(job.wav, { flags: 'wx' }));
        if (total !== bytes) throw new Error('Tải tệp không đầy đủ');
        jobs.set(job.id, job);
        send(res, 202, { id: job.id });
        void infer(job);
      } catch {
        active = null;
        await rm(job.dir, { recursive: true, force: true }).catch(() => {});
        send(res, 400, { error: 'Không nhận được tệp âm thanh WAV hoàn chỉnh' });
      }
      return;
    }
    const match = /^\/api\/jobs\/([0-9a-f-]{36})$/.exec(req.url || '');
    if (match) {
      const job = jobs.get(match[1]);
      if (!job) { send(res, 404, { error: 'Tác vụ không tồn tại hoặc đã hết hạn' }); return; }
      if (req.method === 'GET') { send(res, 200, inspectJob(job)); return; }
      if (req.method === 'DELETE') {
        if (job.child) job.child.kill('SIGTERM');
        job.message = 'Đã yêu cầu hủy nhận diện';
        send(res, 202, { message: job.message }); return;
      }
    }
    send(res, 404, { error: 'Đường dẫn không tồn tại' });
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const server = createNotiqServer();
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => {
    console.log('NOTIQ private MuScriptor API listening');
  });
}
