// NOTIQ AI Core browser-only experiment. Runs inside a dedicated Web Worker.
// Loads a user-supplied noncommercial GGUF into WASM virtual memory; no API calls.
// Do not wire this into the production NOTIQ GUI until real GGUF inference passes.
let engine = null;
let ready = false;
const memoryPath = '/notiq/model.gguf';
const MAX_SAMPLES = 15 * 60 * 16000;
// Same pinned, noncommercial MuScriptor Small model used by original NOTIQ.
const SMALL_MODEL_BYTES = 209425152;
const SMALL_MODEL_SHA256 = '925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4';

function report(type, details = {}) {
  self.postMessage({ type, ...details });
}
function checkResult(payload) {
  return payload && payload.schema === 1 && payload.engine === 'muscriptor' &&
    Array.isArray(payload.notes) && payload.notes.length <= 150000 &&
    payload.notes.every(n =>
      Number.isFinite(n.startTimeSeconds) && n.startTimeSeconds >= 0 &&
      Number.isFinite(n.durationSeconds) && n.durationSeconds > 0 &&
      Number.isInteger(n.pitchMidi) && n.pitchMidi >= 0 && n.pitchMidi <= 127 &&
      Number.isInteger(n.program) && n.program >= 0 && n.program <= 128 &&
      Number.isFinite(n.amplitude) && n.amplitude >= 0 && n.amplitude <= 1 &&
      typeof n.isDrum === 'boolean');
}
function getError() {
  return engine?.UTF8ToString(engine._notiq_core_error()) || 'NOTIQ AI Core: lỗi chưa xác định';
}
function cppString(text) {
  const bytes = new TextEncoder().encode(text + '\0');
  const ptr = engine._malloc(bytes.length);
  if (!ptr) throw new Error('Không đủ bộ nhớ WASM');
  engine.HEAPU8.set(bytes, ptr);
  return ptr;
}
async function loadModel({ moduleUrl, model }) {
  if (ready) throw new Error('MuScriptor đang được nạp. Hãy dùng một Worker mới.');
  if (!(model instanceof ArrayBuffer) || model.byteLength !== SMALL_MODEL_BYTES)
    throw new Error('Giai đoạn thử nghiệm chỉ nhận GGUF MuScriptor Small 209 MB đúng bản gốc.');
  if (!self.crypto?.subtle) throw new Error('Cần HTTPS để kiểm tra SHA-256 của mô hình.');
  report('loading', { message: 'Đang xác minh SHA-256 mô hình MuScriptor gốc' });
  const digest = new Uint8Array(await self.crypto.subtle.digest('SHA-256', model));
  const checksum = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  if (checksum !== SMALL_MODEL_SHA256)
    throw new Error('GGUF không khớp mã SHA-256 của MuScriptor Small gốc.');
  const url = new URL(moduleUrl, self.location.href);
  if (url.origin !== self.location.origin || !url.pathname.endsWith('.js'))
    throw new Error('Chỉ tải mã NOTIQ AI Core từ cùng website.');
  report('loading', { message: 'Đang khởi tạo NOTIQ AI Core WebAssembly' });
  const library = await import(url.href);
  if (typeof library.default !== 'function') throw new Error('Bộ máy NOTIQ WASM không hợp lệ.');
  engine = await library.default({ locateFile: file => new URL(file, url.href).href });
  engine.FS.mkdir('/notiq');
  report('loading', { message: 'Đang nạp tệp GGUF vào bộ nhớ cục bộ' });
  engine.FS.writeFile(memoryPath, new Uint8Array(model));
  const pointer = cppString(memoryPath);
  try {
    if (engine._notiq_core_load_model(pointer) !== 1)
      throw new Error(getError());
  } finally {
    engine._free(pointer);
    // MuScriptor loads the weights into ggml during load; release the duplicate
    // GGUF file from Emscripten MEMFS even after an inference/load failure.
    try { engine.FS.unlink(memoryPath); } catch { /* may already be removed */ }
  }
  ready = true;
  report('ready', { message: 'MuScriptor gốc đã sẵn sàng trong trình duyệt' });
}
function transcribe({ pcm, sampleRate }) {
  if (!ready) throw new Error('Chưa tải MuScriptor WebAssembly và model thật.');
  if (sampleRate !== 16000 || !(pcm instanceof ArrayBuffer))
    throw new Error('Cần PCM mono 16 kHz Float32.');
  const samples = new Float32Array(pcm);
  if (!samples.length || samples.length > MAX_SAMPLES)
    throw new Error('Chỉ hỗ trợ tệp âm thanh hợp lệ không quá 15 phút.');
  const ptr = engine._malloc(samples.byteLength);
  if (!ptr) throw new Error('Không đủ RAM để phân tích bài hát.');
  try {
    engine.HEAPF32.set(samples, ptr / 4);
    report('processing', { message: 'MuScriptor đang nhận diện nốt thật; có thể mất nhiều phút' });
    // Blocking computation happens on this worker, never on the UI thread.
    if (engine._notiq_core_transcribe(ptr, samples.length) !== 1)
      throw new Error(getError());
    const json = engine.UTF8ToString(engine._notiq_core_result_json());
    const result = JSON.parse(json);
    if (!checkResult(result)) throw new Error('MuScriptor trả dữ liệu MIDI sai định dạng.');
    report('complete', { result });
  } finally {
    engine._free(ptr);
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') await loadModel(data);
    else if (data.type === 'transcribe') transcribe(data);
    else if (data.type === 'unload') {
      engine?._notiq_core_unload();
      if (engine) { try { engine.FS.unlink(memoryPath); } catch { /* removed after load */ } }
      engine = null;
      ready = false;
      report('unloaded');
    } else throw new Error('Lệnh NOTIQ AI Core không hợp lệ.');
  } catch (error) {
    report('error', { message: error instanceof Error ? error.message : String(error) });
  }
};
