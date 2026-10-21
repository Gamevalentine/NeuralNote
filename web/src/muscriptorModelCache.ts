// Stage 5: optional, quota-aware browser CacheStorage for original MuScriptor
// Small GGUF bytes. No audio is stored, and no server is involved. The WASM
// worker always validates the original SHA-256, including cached responses.
const CACHE_NAME = 'notiq-muscriptor-small-noncommercial-v1';
const MODEL_BYTES = 209_425_152;
const MIN_HEADROOM = MODEL_BYTES * 2;
function available() {
  // Explicit opt-in: browser site data can otherwise consume the Windows C: drive.
  return import.meta.env.VITE_NOTIQ_MODEL_CACHE === '1'
    && typeof caches !== 'undefined' && typeof navigator !== 'undefined'
    && Boolean(navigator.storage?.estimate) && Boolean(globalThis.isSecureContext);
}
export async function cachedModel(url: string): Promise<Response | null> {
  if (!available()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    if (!response) return null;
    if (!response.ok || response.type === 'opaque') {
      await cache.delete(url);
      return null;
    }
    const length = response.headers.get('content-length');
    if (length && Number(length) !== MODEL_BYTES) {
      await cache.delete(url);
      return null;
    }
    return response;
  } catch {
    // Private browsing, blocked CacheStorage and low disk space must not stop
    // real model inference: the official GGUF download remains the fallback.
    return null;
  }
}
export async function cacheOfficialModel(url: string, copy: Response): Promise<boolean> {
  if (!available()) return false;
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage) ||
        quota! - usage! < MIN_HEADROOM) return false;
    if (!copy.ok || copy.type === 'opaque') return false;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, copy);
    return true;
  } catch {
    return false;
  }
}
export async function discardCachedModel(url: string): Promise<void> {
  if (!available()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(url);
  } catch {
    // Offline and private browsing remain functional without a model cache.
  }
}
