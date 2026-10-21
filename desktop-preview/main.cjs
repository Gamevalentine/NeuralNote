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

const { MODELS, getModel } = require('./models.cjs');
const { hasVerifiedModel, downloadVerifiedModel } = require('./model-download.cjs');
const pianoRuntime = require('./transkun-runtime.cjs');
const pianoRunnerSource = fs.readFileSync(path.join(__dirname,'transkun-runner.py'),'utf8');
const portableDir = path.dirname(process.execPath);
const dataDir = path.join(portableDir, 'NOTIQ-Data');
const modelsDir = path.join(portableDir, 'models');
const selectedModelPath = () => path.join(modelsDir, getModel(selectedModel).filename);
const bridgeBinary = path.join(process.resourcesPath, 'bridge-bin', 'notiq-muscriptor-cli.exe');

// Prefer writing Chromium cache, weights, and temporary audio beside the portable
// app; users installing to E: should not receive a 200 MB model on C:.
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
app.setPath('sessionData', dataDir);
const preferencesPath = path.join(dataDir,'model-preferences.json');
let selectedModel = 'small';
try {
  const stored = JSON.parse(fs.readFileSync(preferencesPath,'utf8'));
  if (stored && typeof stored.selectedModel === 'string' && Object.hasOwn(MODELS,stored.selectedModel))
    selectedModel = stored.selectedModel;
} catch { /* first launch or invalid preferences, retain Small */ }

let window = null;
let downloadJob = null;
let transcriptionJob = null;
let pianoJob = null;
let pianoSetupJob = null;
function report(kind, percent, message) {
  if (window && !window.isDestroyed()) {
    window.webContents.send('notiq:progress', {
      kind, percent: Math.max(0, Math.min(100, Math.round(percent))), message,
    });
  }
}

function bridgeStatus() {
  const model=getModel(selectedModel), filename=selectedModelPath();
  let size=0;
  try {size=fs.statSync(filename).size;} catch {}
  return {
    available: process.platform === 'win32' && fs.existsSync(bridgeBinary),
    modelInstalled: size === model.bytes,
    modelSize: model.id,
    modelLabel: model.label,
    modelBytes: model.bytes,
    modelLocation: 'models/' + model.filename,
    availableModels: Object.keys(MODELS),
    license: 'CC BY-NC 4.0; phi thương mại',
    busy: !!transcriptionJob,
    downloading: !!downloadJob,
  };
}
function selectModel(id) {
  if (downloadJob || transcriptionJob || pianoJob || pianoSetupJob) throw Error('Hãy kết thúc tải mô hình/nhận diện trước khi đổi model.');
  // Check against the whitelist before persisting; never accept a file path.
  const selected=getModel(id);
  selectedModel=selected.id;
  fs.writeFileSync(preferencesPath,JSON.stringify({selectedModel},null,2),'utf8');
  return bridgeStatus();
}
async function downloadModel() {
  if(downloadJob) return downloadJob;
  const selected=getModel(selectedModel);
  const filename=path.join(modelsDir,selected.filename);
  downloadJob=(async()=>{
    try {
      await downloadVerifiedModel(selected,filename,(pct)=>{
        report('download',pct,'Đang tải MuScriptor '+selected.label+' ('+pct+'%)');
      });
      report('download',100,'MuScriptor '+selected.label+' đã xác minh SHA-256');
      return bridgeStatus();
    }catch(error){
      // A valid partial GGUF is retained beside NOTIQ on the chosen E: drive.
      throw Error('Tải MuScriptor '+selected.label+' thất bại: '+(error?.message||String(error))
        + '. Bạn có thể bấm Tải mô hình để tiếp tục.');
    }
  })();
  try{return await downloadJob}finally{downloadJob=null}
}

async function transcribeViaNative(input) {
  if (transcriptionJob || pianoJob) throw new Error('Engine nhận diện khác đang xử lý một bản nhạc.');
  if (!bridgeStatus().available) throw new Error('Không tìm thấy MuScriptor native CLI trong bản Windows này.');
  const model=getModel(selectedModel);
  const modelPath=path.join(modelsDir,model.filename);
  if (!bridgeStatus().modelInstalled)
    throw new Error('Chưa tải MuScriptor '+model.label+'. Hãy chọn Tải mô hình trước.');
  if (!(await hasVerifiedModel(model,modelPath)))
    throw new Error('SHA-256 model '+model.label+' không hợp lệ. Hãy tải lại bản chính thức.');
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (raw.byteLength < 44 || raw.byteLength > 15*60*16000*4+4096)
    throw new Error('MuScriptor hỗ trợ tệp đã chuyển đổi tối đa 15 phút.');
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
      report('transcribe', 0, 'Đang khởi động MuScriptor '+model.label+' trên CPU (Large có thể rất chậm và dùng nhiều RAM)');
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

async function pianoStatus(){
  return {available:process.platform==='win32',installed:await pianoRuntime.installed(dataDir),
    description:'Transkun V2 Piano CPU · MIT; checkpoint chính thức đi kèm gói PyPI'};
}
async function installPiano() {
  if(pianoSetupJob)return pianoSetupJob;
  if(transcriptionJob || pianoJob || downloadJob)throw Error('Hãy hoàn tất tác vụ đang chạy.');
  pianoSetupJob=(async()=>{
    const result=await pianoRuntime.setup(dataDir,pianoRunnerSource,message=>
      report('setup',0,'Transkun V2: '+message));
    report('setup',100,'Transkun V2 đã cài đặt và xác minh mô hình Piano');
    return result;
  })();
  try{return await pianoSetupJob}finally{pianoSetupJob=null}
}
async function transcribePiano(input) {
  if(pianoJob || transcriptionJob || downloadJob || pianoSetupJob)
    throw Error('Một tác vụ AI khác đang chạy. Hãy hoàn tất trước.');
  const raw=input instanceof Uint8Array?input:new Uint8Array(input);
  if(raw.byteLength<44||raw.byteLength>15*60*16000*4+44 ||
      String.fromCharCode(...raw.subarray(0,4))!=='RIFF')
    throw Error('Dữ liệu phải là WAV mono 16 kHz (tối đa 15 phút).');
  pianoJob=pianoRuntime.transcribe(dataDir,raw,pianoRunnerSource,message=>
    report('transcribe',0,'Transkun V2: '+message));
  try {
    const result=await pianoJob;
    report('transcribe',100,'Transkun V2 nhận diện '+result.notes.length+' nốt Piano');
    return result;
  } finally {pianoJob=null}
}
function createWindow() {
  window = new BrowserWindow({
    title: 'NOTIQ — NeuralNote MuScriptor Core (Windows)', width: 1440, height: 900,
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
  ipcMain.handle('notiq:select-model', (_event, id) => selectModel(id));
  ipcMain.handle('notiq:transcribe', (_event, bytes) => transcribeViaNative(bytes));
  ipcMain.handle('notiq:piano-status', () => pianoStatus());
  ipcMain.handle('notiq:piano-install', () => installPiano());
  ipcMain.handle('notiq:piano-transcribe', (_event, bytes) => transcribePiano(bytes));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
