'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {UV_URL,UV_SHA,localPaths,checkZipEntry}=require('../transkun-runtime.cjs');
test('Pinned, HTTPS-only official uv tool from a versioned GitHub release',()=>{
 assert.match(UV_URL,/^https:\/\/github\.com\/astral-sh\/uv\/releases\/download\/0\.13\.4\/uv-x86_64-pc-windows-msvc\.zip$/);
 assert.equal(UV_SHA,'ccec7508a07d9933d7cb1261880633efcf1f30d6e6eddab21823f1dae6f23225');
});
test('Transkun file system paths remain under caller-provided portable drive',()=>{
 const p=localPaths('E:\\NOTIQ-Portable\\NOTIQ-Data');
 for(const key of ['uv','venv','python','runner','temp','cache','pythons'])
  assert.equal(p[key].startsWith('E:\\NOTIQ-Portable\\NOTIQ-Data'),true,key);
});
test('Bad ZIP archives are rejected before any executable is extracted',()=>{
 assert.throws(()=>checkZipEntry(Buffer.alloc(90),'uv.exe'),/incomplete/);
 assert.throws(()=>checkZipEntry(Buffer.from('not a real zip'),'uv.exe'),/incomplete/);
});
test('Official Windows app has separate Piano IPC and default MuScriptor untouched',()=>{
 const base=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 const pre=fs.readFileSync(path.join(__dirname,'../preload.cjs'),'utf8');
 assert.match(base,/ipcMain\.handle\('notiq:piano-transcribe'/);
 assert.match(base,/ipcMain\.handle\('notiq:piano-install'/);
 assert.match(base,/ipcMain\.handle\('notiq:transcribe'/);
 assert.match(pre,/transcribePiano:.*notiq:piano-transcribe/);
 assert.match(base,/selectedModel = 'small'/);
 assert.match(base,/NOTIQ-Data/);
});
test('Transkun install is manual opt-in: setup is only called from Piano install handler',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 assert.equal((s.match(/pianoRuntime\.setup\(/g)||[]).length,1);
 assert.match(s,/ipcMain\.handle\('notiq:piano-install', \(\) => installPiano\(\)\)/);
});
