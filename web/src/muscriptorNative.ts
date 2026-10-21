import { toPianoNotes, type MuScriptorResult } from './muscriptorProtocol';
import type { Note } from './audio';
import { assertSupportedSong, MAX_SONG_BYTES } from './longAudio';

export type NativeStatus = {
  available: boolean;
  modelInstalled: boolean;
  modelSize?: 'small' | 'large';
  modelLabel?: string;
  availableModels?: string[];
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
      selectModel?: (size: 'small' | 'large') => Promise<NativeStatus>;
      transcribe: (wave: Uint8Array) => Promise<MuScriptorResult>;
      onProgress: (handler: (progress: NativeProgress) => void) => () => void;
    };
  }
}

const SAMPLE_RATE = 16_000;
const NATIVE_RESAMPLE_CHUNK_SECONDS = 45;
const WAV_HEADER = 44;

export function nativeBridgeAvailable(): boolean {
  return typeof window.notiqNative?.status === 'function'
    && typeof window.notiqNative?.transcribe === 'function';
}

export async function convertAudioToNativeWav(source: Blob, onConversionProgress?: (percent: number) => void): Promise<Uint8Array> {
  const audioContext = new AudioContext();
  try {
    const audio = await audioContext.decodeAudioData(await source.arrayBuffer());
    assertSupportedSong(audio.duration);
    const frames = Math.round(audio.duration * SAMPLE_RATE);
    const bytes = new Uint8Array(WAV_HEADER + frames * 4);
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
    view.setUint32(40, frames*4, true);
    const perChunk = SAMPLE_RATE * NATIVE_RESAMPLE_CHUNK_SECONDS;
    for (let startFrame = 0; startFrame < frames; startFrame += perChunk) {
      const chunkFrames = Math.min(perChunk, frames - startFrame);
      const offline = new OfflineAudioContext(1, chunkFrames, SAMPLE_RATE);
      const node = offline.createBufferSource();
      node.buffer = audio;
      node.connect(offline.destination);
      node.start(0, startFrame / SAMPLE_RATE, chunkFrames / SAMPLE_RATE);
      const buffer = await offline.startRendering();
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < chunkFrames; ++i)
        view.setFloat32(WAV_HEADER + (startFrame+i)*4, samples[i], true);
      onConversionProgress?.(Math.min(100, Math.round((startFrame+chunkFrames) / frames * 100)));
    }
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
    if (source.size > MAX_SONG_BYTES) throw new Error('Bài hát phải nhỏ hơn 200 MB.');
    const wav = await convertAudioToNativeWav(source, percent =>
      onProgress({ kind:'transcribe', percent: Math.min(2, Math.round(percent * 0.02)),
        message: 'Đang chuẩn bị âm thanh toàn bài: ' + percent + '%' }));
    onProgress({ kind:'transcribe', percent: 2, message:'Đang gửi âm thanh sang MuScriptor CPU…' });
    const result = await bridge.transcribe(wav);
    return toPianoNotes(result);
  } finally {
    detach();
  }
}
