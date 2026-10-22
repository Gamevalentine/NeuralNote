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
const { spawn, spawnSync } = require('node:child_process');

const { MODELS, getModel } = require('./models.cjs');
const { hasVerifiedModel, downloadVerifiedModel } = require('./model-download.cjs');
const { createNativeProgressParser } = require('./native-progress.cjs');
const { runBenchmark } = require('./benchmark-native.cjs');
const { cpuThreadCount } = require('./cpu-threads.cjs');
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
let selectedCpuThreads = 2;
try {
  const stored = JSON.parse(fs.readFileSync(preferencesPath,'utf8'));
  if (stored && typeof stored.selectedModel === 'string' && Object.hasOwn(MODELS,stored.selectedModel))
    selectedModel = stored.selectedModel;
  if (stored && [2,4,6].includes(stored.cpuThreads))
    selectedCpuThreads = stored.cpuThreads;
} catch { /* first launch or invalid preferences, retain Small */ }

let window = null;
let downloadJob = null;
let transcriptionJob = null;
let benchmarkJob = null;
let activeMuScriptor = null;
let pianoJob = null;
let pianoSetupJob = null;
function report(kind, percent, message) {
  if (window && !window.isDestroyed()) {
    window.webContents.send('notiq:progress', {
      kind, percent: Math.max(0, Math.min(100, Math.round(percent))), message,
    });
  }
}

let threadCapabilitiesCached=null;
function cpuThreadCapabilities(){
  if(threadCapabilitiesCached)return threadCapabilitiesCached;
  // The old Stage5A-L binary does not understand --threads and must never
  // silently pretend 4/6 cores are supported.
  if(process.platform!=='win32'||!fs.existsSync(bridgeBinary))
    return {supported:false,values:[2],default:2};
  try{
    const r=spawnSync(bridgeBinary,['--capabilities'],{
      shell:false,windowsHide:true,timeout:4000,encoding:'utf8',maxBuffer:4096
    });
    if(r.status!==0)return {supported:false,values:[2],default:2};
    const capabilities=JSON.parse(r.stdout);
    if(capabilities.bridge==='notiq-muscriptor' && capabilities.schema===1 &&
       JSON.stringify(capabilities.cpu_threads)==='[2,4,6]' &&
       capabilities.default_threads===2){
      threadCapabilitiesCached={supported:true,values:[2,4,6],default:2,resumeCheckpoint:capabilities.resume_checkpoint===true};
      return threadCapabilitiesCached;
    }
  }catch{ /* stay on legacy default 2 */ }
  return {supported:false,values:[2],default:2};
}
function persistModelPrefs(){
  fs.writeFileSync(preferencesPath,JSON.stringify({
    selectedModel,cpuThreads:selectedCpuThreads
  },null,2),'utf8');
}
function applyCpuThreads(threadCount){
  if(transcriptionJob||benchmarkJob||pianoJob||downloadJob||pianoSetupJob)
    throw Error('Hãy hoàn tất hoặc dừng tác vụ trước khi thay số luồng CPU.');
  if(!cpuThreadCapabilities().supported)
    throw Error('Binary MuScriptor cũ không hỗ trợ 4/6 luồng; dùng gói NOTIQ 5M-B mới.');
  selectedCpuThreads=cpuThreadCount(threadCount);
  persistModelPrefs();
  return bridgeStatus();
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
    threadOptions: cpuThreadCapabilities().values,
    nativeThreadsSupported: cpuThreadCapabilities().supported,
    selectedCpuThreads: cpuThreadCapabilities().supported ? selectedCpuThreads : 2,
    license: 'CC BY-NC 4.0; phi thương mại',
    busy: !!transcriptionJob || !!benchmarkJob,
    benchmarkBusy: !!benchmarkJob,
    downloading: !!downloadJob,
  };
}
function selectModel(id) {
  if (downloadJob || transcriptionJob || benchmarkJob || pianoJob || pianoSetupJob) throw Error('Hãy kết thúc tải mô hình/nhận diện trước khi đổi model.');
  // Check against the whitelist before persisting; never accept a file path.
  const selected=getModel(id);
  selectedModel=selected.id;
  persistModelPrefs();
  return bridgeStatus();
}
async function downloadModel() {
  if(benchmarkJob)throw Error('Hãy dừng benchmark trước khi tải model.');
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

function cancelMuScriptor() {
  const job = activeMuScriptor;
  if (!job || job.cancelled) return { requested: false, reason: 'Không có MuScriptor đang nhận diện.' };
  job.cancelled = true;
  report('transcribe', job.percent, 'Đang dừng MuScriptor theo yêu cầu của bạn…');
  if (job.child && job.child.exitCode === null && !job.child.killed)
    job.child.kill(); // Windows TerminateProcess; do not kill any other process.
  return { requested: true };
}
async function transcribeViaNative(input) {
  if (transcriptionJob || pianoJob || benchmarkJob) throw new Error('Engine nhận diện khác đang xử lý một bản nhạc.');
  if (!bridgeStatus().available) throw new Error('Không tìm thấy MuScriptor native CLI trong bản Windows này.');
  const model=getModel(selectedModel);
  const modelPath=path.join(modelsDir,model.filename);
  if (!bridgeStatus().modelInstalled)
    throw new Error('Chưa tải MuScriptor '+model.label+'. Hãy chọn Tải mô hình trước.');
  const resumable=!!(input && typeof input==='object' && input.resumable===true);
  const supplied=resumable?input.wav:input;
  if(!supplied || !(supplied instanceof Uint8Array) && !(supplied instanceof ArrayBuffer))
    throw Error('Dữ liệu âm thanh không hợp lệ.');
  const raw=supplied instanceof Uint8Array?supplied:new Uint8Array(supplied);
  if (raw.byteLength < 44 || raw.byteLength > 15*60*16000*4+4096)
    throw new Error('MuScriptor hỗ trợ tệp đã chuyển đổi tối đa 15 phút.');
  if (String.fromCharCode(...raw.subarray(0,4)) !== 'RIFF')
    throw new Error('Dữ liệu âm thanh chuyển sang native không phải WAV.');

  const job = {cancelled:false,child:null,percent:0,lastProgressAt:Date.now(),startedAt:Date.now()};
  activeMuScriptor=job;
  // Protect the entire SHA256 verification + child lifecycle, not just spawn.
  const task=(async()=>{
    report('transcribe',0,'Đang xác minh model '+model.label+' (SHA-256 2,74 GB có thể mất thời gian trên ổ ngoài)…');
    if (!(await hasVerifiedModel(model,modelPath)))
      throw new Error('SHA-256 model '+model.label+' không hợp lệ. Hãy tải lại bản chính thức.');
    if(job.cancelled)throw new Error('Bạn đã hủy nhận diện trước khi khởi động AI.');
    // Keep only an atomic resume checkpoint, never the user's source WAV.
    const cpuThreads=cpuThreadCapabilities().supported?selectedCpuThreads:2;
    const digest=resumable?createHash('sha256').update(raw).update(':')
      .update(model.sha256).update(':').update(String(cpuThreads)).digest('hex'):null;
    const checkpointDir=path.join(dataDir,'long-song-checkpoints');
    const checkpointPath=resumable?path.join(checkpointDir,digest+'.cp'):null;
    if(resumable)await fsp.mkdir(checkpointDir,{recursive:true});
    const workRoot=path.join(dataDir,'bridge-work');
    await fsp.mkdir(workRoot,{recursive:true});
    const work=await fsp.mkdtemp(path.join(workRoot,'job-'));
    const audio=path.join(work,'input.wav'),output=path.join(work,'notes.json');
    try {
      if(job.cancelled)throw new Error('Bạn đã hủy nhận diện.');
      await fsp.writeFile(audio,raw);
      if(job.cancelled)throw new Error('Bạn đã hủy nhận diện.');
      report('transcribe',0,'MuScriptor '+model.label+' khởi chạy CPU; đang chờ tiến độ thật từ engine…');
      await new Promise((resolve,reject)=>{
        let stderr='',stdout='';
        let settled=false;
        const threads=cpuThreads;
        const args=cpuThreadCapabilities().supported
          ? [audio,modelPath,output,'--threads='+threads]:[audio,modelPath,output];
        if(resumable){
          if(!cpuThreadCapabilities().supported)throw Error('Cần bản MuScriptor mới có checkpoint hỗ trợ.');
          args.push('--checkpoint='+checkpointPath);
        }
        const child=spawn(bridgeBinary,args,{
          shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:work,
        });
        job.child=child;
        job.lastProgressAt=Date.now();
        const finish=(error)=>{
          if(settled)return;
          settled=true;
          clearInterval(heartbeat);
          if(error)reject(error);else resolve();
        };
        // Heartbeats are wall-clock diagnostics, NEVER made-up model progress.
        const heartbeat=setInterval(()=>{
          if(settled || job.cancelled)return;
          const seconds=Math.floor((Date.now()-job.lastProgressAt)/1000);
          const elapsed=Math.floor((Date.now()-job.startedAt)/1000);
          const label=seconds>=90
            ? 'Không có cập nhật AI mới '+seconds+' giây; Large có thể xử lý chậm hoặc bị kẹt. Kiểm tra CPU trong Task Manager, hoặc bấm Dừng AI.'
            : 'MuScriptor đang chạy (tổng '+elapsed+' giây, cập nhật cuối '+seconds+' giây trước). Bạn có thể Dừng AI.';
          report('transcribe',job.percent,label);
        },15000);
        let checkpointLines='';
        const parseCheckpoints=text=>{
          checkpointLines=(checkpointLines+text).slice(-4096);
          let at;
          while((at=checkpointLines.indexOf('\n'))!==-1){
            const line=checkpointLines.slice(0,at).trim();
            checkpointLines=checkpointLines.slice(at+1);
            const update=/^NOTIQ_CHECKPOINT (\d+) ([0-9]+(?:\.[0-9]+)?)$/.exec(line);
            if(update && resumable){
              report('checkpoint',job.percent,
                'Đã lưu '+update[1]+' nốt · đã xác nhận tới '+update[2]+
                ' giây. Có thể Dừng và tiếp tục từ checkpoint.');
            }
            const resumed=/^NOTIQ_RESUMED_NOTES (\d+)$/.exec(line);
            if(resumed && resumable)report('checkpoint',job.percent,
              'Đang tiếp tục bài cũ từ checkpoint, giữ nguyên '+resumed[1]+' nốt đã xác nhận.');
          }
        };
        const progressParser=createNativeProgressParser(pct=>{
          job.percent=pct;
          job.lastProgressAt=Date.now();
          report('transcribe',pct,pct<20
            ?'MuScriptor '+model.label+' đang nạp model ('+pct+'% từ engine)'
            :'MuScriptor '+model.label+' nhận diện ('+pct+'% từ engine)');
        });
        child.stderr.on('data',chunk=>{
          const value=String(chunk);
          stderr=(stderr+value).slice(-9000);
          progressParser.push(value);
          parseCheckpoints(value);
        });
        child.stdout.on('data',chunk=>{stdout=(stdout+String(chunk)).slice(-1500);});
        child.once('error',error=>finish(error));
        child.once('close',code=>{
          if(job.cancelled)finish(new Error('Đã dừng MuScriptor theo yêu cầu. Nốt đang chỉnh vẫn được giữ nguyên.'));
          else if(code!==0)finish(new Error('MuScriptor kết thúc lỗi (mã '+String(code)+'). '+stderr.slice(-800)));
          else finish(null);
        });
        if(job.cancelled && child.exitCode===null)child.kill();
      });
      if(job.cancelled)throw new Error('Đã hủy nhận diện MuScriptor.');
      const result=JSON.parse(await fsp.readFile(output,'utf8'));
      if(result?.schema!==1 || result?.engine!=='muscriptor' || !Array.isArray(result.notes))
        throw new Error('Kết quả từ native bridge không hợp lệ.');
      report('transcribe',100,'MuScriptor '+model.label+' đã nhận diện '+result.notes.length+' nốt');
      return result;
    }finally{
      await fsp.rm(work,{recursive:true,force:true}).catch(()=>{});
    }
  })();
  transcriptionJob=task;
  try{return await task}
  finally{transcriptionJob=null;if(activeMuScriptor===job)activeMuScriptor=null;}
}

async function benchmarkViaNative(payload) {
  if(benchmarkJob || transcriptionJob || pianoJob || pianoSetupJob || downloadJob)
    throw Error('Một tác vụ AI khác đang hoạt động. Dừng hoặc hoàn tất trước khi benchmark.');
  if(!bridgeStatus().available || !bridgeStatus().modelInstalled)
    throw Error('Cần mô hình MuScriptor đã tải và ứng dụng Windows có native CLI.');
  if(!cpuThreadCapabilities().supported)throw Error('Cần binary CPU 5M-B thực, không thể benchmark 4/6 luồng với binary cũ.');
  const model=getModel(selectedModel);
  const job={cancelled:false,child:null,percent:0};
  activeMuScriptor=job; // shared scoped cancellation with normal inference
  const task=(async()=>{
    const reportBenchmark=(message,percent)=>{
      job.percent=percent;
      report('benchmark',percent,message);
    };
    const results=await runBenchmark({
      wav:payload?.wav,seconds:payload?.seconds,startSeconds:payload?.startSeconds??0,
      threads:cpuThreadCount(payload?.threads ?? 2),
      model,modelPath:path.join(modelsDir,model.filename),
      bridgeBinary,dataDir,job,verifyModel:hasVerifiedModel,
      onProgress:reportBenchmark,
    });
    if(job.cancelled)throw Error('Đã hủy benchmark, không lưu kết quả.');
    results.audioPrepareMs=Number.isFinite(payload?.audioPrepareMs)
      ?Math.max(0,Math.min(3600000,Math.round(payload.audioPrepareMs))):null;
    const benchmarkDir=path.join(dataDir,'benchmarks');
    await fsp.mkdir(benchmarkDir,{recursive:true});
    const filename='notiq-'+model.id+'-'+results.clipSeconds+'s-'+
      new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)+'.json';
    const file=path.join(benchmarkDir,filename);
    // Only time/CPU/RAM/notes count. Never write source audio or recognized notes.
    await fsp.writeFile(file,JSON.stringify(results,null,2),'utf8');
    reportBenchmark('Benchmark hoàn tất. Đã lưu kết quả trong NOTIQ-Data/benchmarks.',100);
    return {...results,savedRelativePath:'NOTIQ-Data/benchmarks/'+filename};
  })();
  benchmarkJob=task;
  try{return await task}
  finally{
    benchmarkJob=null;
    if(activeMuScriptor===job)activeMuScriptor=null;
  }
}

async function pianoStatus(){
  return {available:process.platform==='win32',installed:await pianoRuntime.installed(dataDir),
    description:'Transkun V2 Piano CPU · MIT; checkpoint chính thức đi kèm gói PyPI'};
}
async function installPiano() {
  if(pianoSetupJob)return pianoSetupJob;
  if(transcriptionJob || benchmarkJob || pianoJob || downloadJob)throw Error('Hãy hoàn tất tác vụ đang chạy.');
  pianoSetupJob=(async()=>{
    const result=await pianoRuntime.setup(dataDir,pianoRunnerSource,message=>
      report('setup',0,'Transkun V2: '+message));
    report('setup',100,'Transkun V2 đã cài đặt và xác minh mô hình Piano');
    return result;
  })();
  try{return await pianoSetupJob}finally{pianoSetupJob=null}
}
async function transcribePiano(input) {
  if(pianoJob || transcriptionJob || benchmarkJob || downloadJob || pianoSetupJob)
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
  ipcMain.handle('notiq:apply-cpu-threads', (_event,n) => applyCpuThreads(n));
  ipcMain.handle('notiq:transcribe', (_event, bytes) => transcribeViaNative(bytes));
  ipcMain.handle('notiq:clear-checkpoint', async (_event, supplied)=>{
    if(transcriptionJob||benchmarkJob||pianoJob)throw Error('Hãy dừng AI trước khi xóa checkpoint.');
    const raw=supplied instanceof Uint8Array?supplied:new Uint8Array(supplied);
    if(raw.byteLength<44||raw.byteLength>15*60*16000*4+4096)
      throw Error('WAV không hợp lệ.');
    const model=getModel(selectedModel);
    const cpu=cpuThreadCapabilities().supported?selectedCpuThreads:2;
    const digest=createHash('sha256').update(raw).update(':').update(model.sha256)
      .update(':').update(String(cpu)).digest('hex');
    const file=path.join(dataDir,'long-song-checkpoints',digest+'.cp');
    try{await fsp.unlink(file);return {cleared:true}}
    catch(e){if(e?.code==='ENOENT')return {cleared:false};throw e}
  });
  ipcMain.handle('notiq:cancel-transcription', () => cancelMuScriptor());
  ipcMain.handle('notiq:benchmark', (_event, payload) => benchmarkViaNative(payload));
  ipcMain.handle('notiq:piano-status', () => pianoStatus());
  ipcMain.handle('notiq:piano-install', () => installPiano());
  ipcMain.handle('notiq:piano-transcribe', (_event, bytes) => transcribePiano(bytes));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
