// Browser-only adapter: implements the same MuScriptor bridge interface as Electron.
// Only enabled when a real, healthy API is explicitly configured at build time.
import type { MuScriptorResult } from './muscriptorProtocol';
import type { NativeProgress, NativeStatus } from './muscriptorNative';

type ApiHealth = { engine: string; available: boolean; modelInstalled: boolean; busy: boolean };
type ApiJob = { state: string; progress?: number; message?: string; error?: string; result?: MuScriptorResult };
const KEY_NAME = 'notiq-private-api-key';
const localOrigin = /^http:\/\/localhost(?::\d+)?$/;

function apiBase(): string | null {
  const configured = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env?.VITE_NOTIQ_MUSCRIPTOR_API?.trim().replace(/\/+$/, '');
  if (!configured) return null;
  // For a private GitHub Codespace: one HTTPS port, with server-side Vite proxy authentication.
  if (configured === 'self') return window.location.origin;
  try {
    const parsed = new URL(configured);
    if (!/^https:$/.test(parsed.protocol) &&
        !(parsed.protocol === 'http:' && localOrigin.test(parsed.origin))) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return null;
    return parsed.origin;
  } catch { return null; }
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') throw new Error('Máy chủ MuScriptor trả về dữ liệu không hợp lệ.');
  if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Máy chủ MuScriptor lỗi HTTP ' + response.status);
  return json as Record<string, unknown>;
}
function accessKey(): string {
  // Credentials stay on the Codespace's server: Vite injects the real private key.
  // This mode is only for the private forwarded Codespaces port.
  if (import.meta.env.VITE_NOTIQ_MUSCRIPTOR_API === 'self') return 'private-forwarded-port';
  let key = '';
  try { key = sessionStorage.getItem(KEY_NAME) || ''; } catch { /* private mode */ }
  if (!key) {
    key = window.prompt('NOTIQ thử nghiệm riêng: nhập mã truy cập máy chủ MuScriptor (không lưu vào GitHub).')?.trim() || '';
    if (!key) throw new Error('Cần mã truy cập thử nghiệm để nhận diện Audio → MIDI trên web.');
    try { sessionStorage.setItem(KEY_NAME, key); } catch { /* browser restricted */ }
  }
  return key;
}
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function isWebMuScriptorConfigured(): boolean { return apiBase() !== null; }

export async function installWebMuScriptorBridge(): Promise<boolean> {
  if (window.notiqNative) return false; // Never override the real Electron bridge.
  const base = apiBase();
  if (!base) return false;
  const health = await fetch(base + '/api/health', { cache: 'no-store' })
    .then(async response => await parseJson(response) as unknown as ApiHealth)
    .catch(() => null);
  if (health?.engine !== 'muscriptor' || !health.available || !health.modelInstalled) return false;
  const listeners = new Set<(progress: NativeProgress) => void>();
  const report = (percent: number, message: string) => {
    for (const listener of listeners) listener({
      kind: 'transcribe', percent: Math.min(100, Math.max(0, percent)), message,
    });
  };
  window.notiqNative = {
    async status(): Promise<NativeStatus> {
      const payload = await parseJson(await fetch(base + '/api/health', { cache: 'no-store' }));
      return {
        available: payload.available === true && payload.modelInstalled === true,
        modelInstalled: payload.modelInstalled === true,
        modelBytes: 0, modelLocation: 'Máy chủ thử nghiệm riêng',
        license: 'MuScriptor CC BY-NC 4.0; chỉ phi thương mại',
        busy: payload.busy === true, downloading: false,
      };
    },
    async downloadModel(): Promise<NativeStatus> {
      throw new Error('Model MuScriptor phải được cài trên máy chủ, không tải qua trình duyệt.');
    },
    async transcribe(wave: Uint8Array): Promise<MuScriptorResult> {
      const key = accessKey();
      const headers = { 'x-notiq-key': key };
      report(1, 'Đang gửi WAV cho máy chủ MuScriptor riêng (âm thanh không lưu lâu dài)');
      const upload = await fetch(base + '/api/jobs', {
        method: 'POST', headers: { ...headers, 'content-type': 'audio/wav' },
        body: new Blob([wave.slice().buffer as ArrayBuffer], { type: 'audio/wav' }),
        cache: 'no-store',
      });
      if (upload.status === 403) {
        try { sessionStorage.removeItem(KEY_NAME); } catch { /* browser restricted */ }
      }
      const jobResponse = await parseJson(upload);
      if (typeof jobResponse.id !== 'string') throw new Error('Máy chủ không trả về mã tác vụ.');
      const jobId = jobResponse.id;
      report(2, 'MuScriptor đang xử lý bài hát');
      // Do not fake percentages: the server streams real CLI progress through polling.
      for (let i = 0; i < 3600; i++) {
        await pause(1250);
        const response = await parseJson(await fetch(base + '/api/jobs/' + encodeURIComponent(jobId),
          { headers, cache: 'no-store' })) as unknown as ApiJob;
        if (response.state === 'error') throw new Error(response.error || 'MuScriptor không nhận diện được bài hát.');
        if (response.state === 'complete') {
          if (!response.result) throw new Error('MuScriptor không trả về kết quả nốt nhạc.');
          report(100, 'Đã nhận kết quả nốt nhạc từ MuScriptor');
          return response.result;
        }
        report(Math.min(98, Number(response.progress) || 2),
          response.message || 'MuScriptor đang chạy');
      }
      throw new Error('MuScriptor quá thời gian phản hồi.');
    },
    onProgress(handler) { listeners.add(handler); return () => { listeners.delete(handler); }; },
  };
  return true;
}
