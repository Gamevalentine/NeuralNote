// NOTIQ browser preview: MIT MuScriptor C++ WASM only. No Basic Pitch fallback,
// server-side recognition, fake MIDI or modification to NOTIQ Desktop.
import type { Note } from './audio';
import { convertAudioToNativeWav } from './muscriptorNative';
import { toPianoNotes, type MuScriptorResult } from './muscriptorProtocol';

type Progress = {kind: 'download' | 'transcribe'; percent: number; message: string};
type WorkerEvent = {type: string; percent?: number; message?: string; result?: MuScriptorResult};
type Task = {kind:'download'|'transcribe'; resolve:(x:WorkerEvent)=>void; reject:(e:Error)=>void; onProgress:(p:Progress)=>void};
const MODEL_URL = 'https://huggingface.co/DamRsn/muscriptor-gguf/resolve/d7045f94e8b19427f4ff9542975035e66596e51c/v1/muscriptor-small-f16.gguf';
const MODEL_BYTES = 209425152;
const root = new URL(import.meta.env.BASE_URL + 'notiq-core/', window.location.href);
let worker: Worker|null = null;
let ready = false;
let active: Task|null = null;

export function webAiEnabled() {
  return import.meta.env.VITE_NOTIQ_WEB_AI === '1' && typeof Worker !== 'undefined'
    && typeof WebAssembly !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}
export function webModelReady() { return ready; }
function instance() {
  if (worker) return worker;
  if (!webAiEnabled()) throw new Error('Bản này chưa bật NOTIQ AI Core WebAssembly.');
  worker = new Worker(new URL('worker.mjs',root),{type:'module'});
  worker.onmessage = ({data}:MessageEvent<WorkerEvent>) => {
    const task=active;
    if (!task) return;
    if (data.type==='progress' && typeof data.percent==='number') {
      const p=Math.max(0,Math.min(100,Math.floor(data.percent)));
      task.onProgress({kind:task.kind,percent:p,message:task.kind==='download'
        ? 'MuScriptor đang nạp GGUF: '+p+'%' : 'MuScriptor đang nhận diện thật: '+p+'%'});
    } else if (data.type==='loading'||data.type==='processing') {
      task.onProgress({kind:task.kind,percent:task.kind==='transcribe'?15:85,
        message:data.message||'MuScriptor đang xử lý…'});
    } else if(data.type==='error') {
      active=null;task.reject(new Error(data.message||'MuScriptor WebAssembly gặp lỗi.'));
    } else if(data.type==='ready'&&task.kind==='download') {
      ready=true;active=null;task.resolve(data);
    } else if(data.type==='complete'&&task.kind==='transcribe') {
      active=null;task.resolve(data);
    }
  };
  worker.onerror = event => {
    active?.reject(new Error('NOTIQ Web Worker: '+(event.message||'Lỗi không xác định')));
    active=null;ready=false;worker?.terminate();worker=null;
  };
  return worker;
}
function send(kind:Task['kind'],message:object,transfers:Transferable[],onProgress:Task['onProgress']) {
  if(active) throw new Error('NOTIQ AI Core đang xử lý yêu cầu khác.');
  const core=instance();
  return new Promise<WorkerEvent>((resolve,reject) => {
    active={kind,resolve,reject,onProgress};
    try {core.postMessage(message,transfers);} catch(error) {active=null;reject(error instanceof Error?error:new Error(String(error)));}
  });
}
export async function installWebModel(onProgress:(p:Progress)=>void) {
  if(ready) return;
  if(!webAiEnabled()) throw new Error('NOTIQ AI Core chưa bật trên bản Preview này.');
  onProgress({kind:'download',percent:0,message:'Đang tải MuScriptor Small 209 MB từ nguồn chính thức…'});
  const response=await fetch(MODEL_URL);
  if(!response.ok||!response.body)throw new Error('Không tải được mô hình MuScriptor (HTTP '+response.status+').');
  const declared=Number(response.headers.get('content-length'));
  if(declared&&declared>MODEL_BYTES)throw new Error('GGUF có dung lượng vượt bản Small đã ghim.');
  const data=new Uint8Array(MODEL_BYTES);
  let received=0;
  const reader=response.body.getReader();
  try {
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      if(received+chunk.value.length>MODEL_BYTES)throw new Error('GGUF vượt kích thước cho phép.');
      data.set(chunk.value,received);received+=chunk.value.length;
      onProgress({kind:'download',percent:Math.floor(received/MODEL_BYTES*80),
        message:'Đang tải mô hình: '+Math.floor(received/MODEL_BYTES*100)+'%'});
    }
  } finally {reader.releaseLock();}
  if(received!==MODEL_BYTES)throw new Error('GGUF tải chưa đầy đủ: '+received+' byte.');
  // Web Worker checks SHA-256 of exact original GGUF before accepting it.
  await send('download',{type:'init',model:data.buffer,
    moduleUrl:new URL('notiq-ai-core.js',root).href},[data.buffer],onProgress);
  onProgress({kind:'download',percent:100,message:'MuScriptor Small sẵn sàng trong trình duyệt.'});
}
export async function recognizeWeb(source:Blob,onProgress:(p:Progress)=>void):Promise<Note[]> {
  if(!ready)throw new Error('Hãy nạp GGUF MuScriptor Small trước khi nhận diện.');
  onProgress({kind:'transcribe',percent:1,message:'Đang chuẩn bị âm thanh 16 kHz mono…'});
  const wav=await convertAudioToNativeWav(source,percent=>
    onProgress({kind:'transcribe',percent:Math.max(1,Math.round(percent*.08)),
      message:'Chuẩn bị âm thanh: '+percent+'%'}));
  const pcm=wav.buffer.slice(wav.byteOffset+44,wav.byteOffset+wav.byteLength);
  onProgress({kind:'transcribe',percent:10,message:'MuScriptor C++ đang nhận diện âm thanh thật…'});
  const response=await send('transcribe',{type:'transcribe',pcm,sampleRate:16000},[pcm],onProgress);
  if(!response.result)throw new Error('MuScriptor không gửi được nốt MIDI.');
  const notes=toPianoNotes(response.result);
  if(notes.length===0)throw new Error('MuScriptor chưa phát hiện được nốt nhạc.');
  return notes;
}
export function closeWebModel() {
  active?.reject(new Error('NOTIQ AI Core đã đóng.'));
  active=null;worker?.terminate();worker=null;ready=false;
}
