'use strict';

// Stage 4: Native MuScriptor C++ runs only as a local child process.
// The renderer is an unprivileged offline copy of NOTIQ Web.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

const model = Object.freeze({
  filename: 'muscriptor-small-f16.gguf',
  bytes: 209425152,
  sha256: '925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4',
  url: 'https://huggingface.co/DamRsn/muscriptor-gguf/resolve/d7045f94e8b19427f4ff9542975035e66596e51c/v1/muscriptor-small-f16.gguf',
});
const portableDir = path.dirname(process.execPath);
const dataDir = path.join(portableDir, 'NOTIQ-Data');
const modelsDir = path.join(portableDir, 'models');
const modelPath = path.join(modelsDir, model.filename);
const bridgeBinary = path.join(process.resourcesPath, 'bridge-bin', 'notiq-muscriptor-cli.exe');

// Prefer writing Chromium cache, weights, and temporary audio beside the portable
// app; users installing to E: should not receive a 200 MB model on C:.
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
app.setPath('sessionData', dataDir);

let window = null;
let downloadJob = null;
let transcriptionJob = null;
function report(kind, percent, message) {
  if (window && !window.isDestroyed()) {
    window.webContents.send('notiq:progress', {
      kind, percent: Math.max(0, Math.min(100, Math.round(percent))), message,
    });
  }
}

function bridgeStatus() {
  let size = 0;
  try { size = fs.statSync(modelPath).size; } catch {}
  return {
    available: process.platform === 'win32' && fs.existsSync(bridgeBinary),
    modelInstalled: size === model.bytes,
    modelBytes: model.bytes,
    modelLocation: 'models/' + model.filename,
    license: 'CC BY-NC 4.0; phi thương mại',
    busy: !!transcriptionJob,
    downloading: !!downloadJob,
  };
}

async function downloadModel() {
  if (downloadJob) return downloadJob;
  downloadJob = (async () => {
    if (fs.existsSync(modelPath) && (await fsp.stat(modelPath)).size === model.bytes) return bridgeStatus();
    await fsp.mkdir(modelsDir, { recursive: true });
    const partial = modelPath + '.partial';
    try {
      const response = await fetch(model.url, { redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error('Máy chủ trả về HTTP ' + response.status);
      const contentType = response.headers.get('content-type') || '';
      if (/text\/html/i.test(contentType)) throw new Error('Máy chủ không trả về checkpoint GGUF');
      const digest = createHash('sha256');
      let received = 0, lastReported = -1;
      const checkChunk = new Transform({
        transform(chunk, _encoding, next) {
          received += chunk.length;
          if (received > model.bytes) { next(new Error('Dung lượng model không hợp lệ')); return; }
          digest.update(chunk);
          const pct = Math.floor((received / model.bytes) * 100);
          if (pct !== lastReported) {
            lastReported = pct;
            report('download', pct, 'Đang tải MuScriptor Small (' + pct + '%)');
          }
          next(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), checkChunk, fs.createWriteStream(partial));
      if (received !== model.bytes || digest.digest('hex').toLowerCase() !== model.sha256)
        throw new Error('Checkpoint không khớp kích thước hoặc SHA-256 đã công bố');
      await fsp.rename(partial, modelPath);
      report('download', 100, 'Đã xác minh SHA-256 của MuScriptor Small');
      return bridgeStatus();
    } catch (error) {
      await fsp.rm(partial, { force: true }).catch(() => {});
      throw new Error('Không tải được model MuScriptor: ' + (error?.message || String(error)));
    }
  })();
  try { return await downloadJob; } finally { downloadJob = null; }
}

async function transcribeViaNative(input) {
  if (transcriptionJob) throw new Error('MuScriptor đang xử lý một bản nhạc khác.');
  if (!bridgeStatus().available) throw new Error('Không tìm thấy MuScriptor native CLI trong bản Windows này.');
  if (!bridgeStatus().modelInstalled)
    throw new Error('Chưa tải MuScriptor Small (209 MB). Vui lòng bấm Tải mô hình trước.');
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (raw.byteLength < 44 || raw.byteLength > 46*16000*4+4096)
    throw new Error('Tệp âm thanh chuẩn bị cho MuScriptor phải ngắn hơn 45 giây.');
  if (String.fromCharCode(...raw.slice(0,4)) !== 'RIFF')
    throw new Error('Dữ liệu âm thanh chuyển sang native không phải WAV.');
  transcriptionJob = (async () => {
    const workRoot = path.join(dataDir, 'bridge-work');
    await fsp.mkdir(workRoot, { recursive: true });
    const work = await fsp.mkdtemp(path.join(workRoot, 'job-'));
    const audio = path.join(work, 'input.wav');
    const output = path.join(work, 'notes.json');
    try {
      await fsp.writeFile(audio, raw);
      report('transcribe', 0, 'Đang khởi động MuScriptor trên CPU');
      await new Promise((resolve, reject) => {
        const child = spawn(bridgeBinary, [audio, modelPath, output], {
          shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe'],
          cwd: work,
        });
        let stderr = '';
        child.stderr.on('data', chunk => {
          stderr = (stderr + String(chunk)).slice(-9000);
          const matches = [...String(chunk).matchAll(/PROGRESS\s+(\d+)/g)];
          for (const match of matches) {
            const pct = Number(match[1]);
            report('transcribe', pct, pct < 20 ? 'Đang tải model vào RAM' : 'MuScriptor đang nhận diện nhạc cụ');
          }
        });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() :
          reject(new Error('MuScriptor thất bại (mã ' + code + '). ' + stderr.slice(-500))));
      });
      const result = JSON.parse(await fsp.readFile(output, 'utf8'));
      if (result?.schema !== 1 || result?.engine !== 'muscriptor' || !Array.isArray(result.notes))
        throw new Error('Kết quả từ native bridge không hợp lệ.');
      report('transcribe', 100, 'MuScriptor đã nhận diện ' + result.notes.length + ' nốt');
      return result;
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  })();
  try { return await transcriptionJob; } finally { transcriptionJob = null; }
}

function createWindow() {
  window = new BrowserWindow({
    title: 'NOTIQ — MuScriptor Desktop Preview', width: 1440, height: 900,
    minWidth: 980, minHeight: 620, backgroundColor: '#111318',
    autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(github\.com|www\.github\.com|huggingface\.co|gleitz\.github\.io)/i.test(url))
      void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, 'www', 'index.html'), {
    query: { review: 'desktop' },
  }).catch(error => { console.error('Cannot load NOTIQ Web UI', error); window.show(); });
}

app.whenReady().then(() => {
  ipcMain.handle('notiq:status', () => bridgeStatus());
  ipcMain.handle('notiq:download-model', () => downloadModel());
  ipcMain.handle('notiq:transcribe', (_event, bytes) => transcribeViaNative(bytes));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
