import { toPianoNotes, type MuScriptorResult } from './muscriptorProtocol';
import type { Note } from './audio';

export type NativeStatus = {
  available: boolean;
  modelInstalled: boolean;
  modelBytes: number;
  modelLocation: string;
  license: string;
  busy: boolean;
  downloading: boolean;
};
export type NativeProgress = {
  kind: 'download' | 'transcribe';
  percent: number;
  message: string;
};

declare global {
  interface Window {
    notiqNative?: {
      status: () => Promise<NativeStatus>;
      downloadModel: () => Promise<NativeStatus>;
      transcribe: (wave: Uint8Array) => Promise<MuScriptorResult>;
      onProgress: (handler: (progress: NativeProgress) => void) => () => void;
    };
  }
}

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 45;
const WAV_HEADER = 44;

export function nativeBridgeAvailable(): boolean {
  return typeof window.notiqNative?.status === 'function'
    && typeof window.notiqNative?.transcribe === 'function';
}

export async function convertAudioToNativeWav(source: Blob): Promise<Uint8Array> {
  const audioContext = new AudioContext();
  try {
    const audio = await audioContext.decodeAudioData(await source.arrayBuffer());
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > MAX_SECONDS)
      throw new Error('MuScriptor hỗ trợ tối đa 45 giây âm thanh trong bản thử.');
    const frames = Math.round(audio.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const node = offline.createBufferSource();
    node.buffer = audio;
    node.connect(offline.destination);
    node.start();
    const downsampled = await offline.startRendering();
    const samples = downsampled.getChannelData(0);

    const bytes = new Uint8Array(WAV_HEADER + samples.length * 4);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset+i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true); // 3 = IEEE float32, not integer PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE*4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 32, true);
    text(36, 'data');
    view.setUint32(40, samples.length*4, true);
    for (let i = 0; i < samples.length; ++i)
      view.setFloat32(WAV_HEADER+i*4, samples[i], true);
    return bytes;
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export async function runMuScriptor(
  source: Blob, onProgress: (progress: NativeProgress) => void,
): Promise<Note[]> {
  const bridge = window.notiqNative;
  if (!bridge) throw new Error('MuScriptor chỉ chạy trên bản NOTIQ Windows có native bridge.');
  const detach = bridge.onProgress(onProgress);
  try {
    onProgress({ kind:'transcribe', percent: 1, message:'Đang chuyển WAV về 16 kHz mono…' });
    const wav = await convertAudioToNativeWav(source);
    onProgress({ kind:'transcribe', percent: 2, message:'Đang gửi âm thanh sang MuScriptor CPU…' });
    const result = await bridge.transcribe(wav);
    return toPianoNotes(result);
  } finally {
    detach();
  }
}
