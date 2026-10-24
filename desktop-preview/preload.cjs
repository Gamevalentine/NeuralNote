'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The browser renderer cannot execute local commands, read arbitrary files,
// or choose executable paths. Only this narrow and fixed native bridge is exposed.
const native = Object.freeze({
  status: () => ipcRenderer.invoke('notiq:status'),
  acceptanceEvidence: () => ipcRenderer.invoke('notiq:5pb-evidence'),
  finalReview: (payload) => ipcRenderer.invoke('notiq:5pc-review',payload),
  finalFingerprint: (audioSha256) => ipcRenderer.invoke('notiq:5pc-fingerprint',audioSha256),
  downloadModel: () => ipcRenderer.invoke('notiq:download-model'),
  pianoStatus: () => ipcRenderer.invoke('notiq:piano-status'),
  installPiano: () => ipcRenderer.invoke('notiq:piano-install'),
  transcribePiano: (wave) => ipcRenderer.invoke('notiq:piano-transcribe', wave),
  selectModel: (id) => ipcRenderer.invoke('notiq:select-model', id),
  transcribe: (waveBytes) => ipcRenderer.invoke('notiq:transcribe', waveBytes),
  cancelTranscription: () => ipcRenderer.invoke('notiq:cancel-transcription'),
  benchmark: (payload) => ipcRenderer.invoke('notiq:benchmark', payload),
  applyCpuThreads: (n) => ipcRenderer.invoke('notiq:apply-cpu-threads', n),
  clearCheckpoint: (wav) => ipcRenderer.invoke('notiq:clear-checkpoint', wav),
  onProgress: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, message) => {
      if (message && (message.kind === 'download' || message.kind === 'transcribe' || message.kind === 'benchmark' || message.kind === 'checkpoint')) {
        handler(message);
      }
    };
    ipcRenderer.on('notiq:progress', listener);
    return () => ipcRenderer.removeListener('notiq:progress', listener);
  },
});
contextBridge.exposeInMainWorld('notiqNative', native);
