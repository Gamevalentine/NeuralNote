'use strict';
// Install the official Transkun v2 Piano engine on the same portable drive as
// NOTIQ. All install steps spawn direct executables; users do not need CMD.
// This module is not imported or executed by NOTIQ Web / Cloudflare.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const zlib=require('node:zlib');
const UV_URL='https://github.com/astral-sh/uv/releases/download/0.13.4/uv-x86_64-pc-windows-msvc.zip';
const UV_SHA='ccec7508a07d9933d7cb1261880633efcf1f30d6e6eddab21823f1dae6f23225';
const UV_ZIP_LIMIT=24*1024*1024;
const PIP_REQUIREMENTS=[
  'numpy==1.26.4','torch==2.5.1','torchaudio==2.5.1','transkun==2.0.1',
  'setuptools<81'
];
function localPaths(portableDataDir){
 const base=path.join(portableDataDir,'transkun-v2');
 return {base,uv:path.join(base,'bin','uv.exe'),venv:path.join(base,'python-env'),
   python:path.join(base,'python-env','Scripts','python.exe'),
   runner:path.join(base,'transkun-runner.py'),temp:path.join(base,'tmp'),
   cache:path.join(base,'uv-cache'),pythons:path.join(base,'python-managed')};
}
function childEnvironment(p){
 return {...process.env,UV_CACHE_DIR:p.cache,UV_PYTHON_INSTALL_DIR:p.pythons,
   UV_PYTHON_BIN_DIR:path.join(p.base,'bin'),UV_NO_PROGRESS:'1',
   UV_NO_MODIFY_PATH:'1',UV_PYTHON_DOWNLOADS:'automatic',
   TMP:p.temp,TEMP:p.temp,TMPDIR:p.temp,HOME:p.base,
   TORCH_HOME:path.join(p.base,'torch-cache'),HF_HOME:path.join(p.base,'hf-cache'),
   PIP_CACHE_DIR:path.join(p.base,'pip-cache'),PYTHONNOUSERSITE:'1',PYTHONUTF8:'1'};
}
function checkZipEntry(zip,fileName){
 const b=Buffer.from(zip);
 // Use the central directory, never local header supplied filenames for paths.
 let eocd=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)
  if(b.readUInt32LE(i)===0x06054b50){eocd=i;break}
 if(eocd<0)throw Error('uv ZIP is incomplete');
 const count=b.readUInt16LE(eocd+10);
 if(count>50)throw Error('Unexpected number of uv ZIP entries');
 let offset=b.readUInt32LE(eocd+16);
 for(let i=0;i<count;i++){
  if(offset+46>b.length||b.readUInt32LE(offset)!==0x02014b50)throw Error('Broken uv ZIP directory');
  const method=b.readUInt16LE(offset+10),compressed=b.readUInt32LE(offset+20),
    raw=b.readUInt32LE(offset+24),nameLen=b.readUInt16LE(offset+28),
    extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32),
    local=b.readUInt32LE(offset+42);
  const name=b.subarray(offset+46,offset+46+nameLen).toString('utf8');
  if(name.toLowerCase().endsWith('/'+fileName)||name.toLowerCase()===fileName){
    if(raw>30*1024*1024||local+30>b.length||b.readUInt32LE(local)!==0x04034b50)
      throw Error('Unsafe uv.exe ZIP entry');
    const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
    if(start+compressed>b.length)throw Error('Truncated uv binary');
    const payload=b.subarray(start,start+compressed);
    const decoded=method===0?payload:method===8?zlib.inflateRawSync(payload):null;
    if(!decoded||decoded.length!==raw||decoded.subarray(0,2).toString()!=='MZ')
      throw Error('uv.exe does not match expected Windows executable');
    return decoded;
  }
  offset+=46+nameLen+extra+comment;
 }
 throw Error('Official uv release missing uv.exe');
}
async function fetchUvBinary(p,fetchImpl=fetch){
 if(fs.existsSync(p.uv))return;
 const response=await fetchImpl(UV_URL,{redirect:'follow'});
 if(!response.ok||!response.body)throw Error('Cannot fetch official uv '+response.status);
 const pieces=[];let total=0;
 for await(const part of response.body){
  const bytes=Buffer.from(part);total+=bytes.length;
  if(total>UV_ZIP_LIMIT)throw Error('uv release archive exceeds size bound');
  pieces.push(bytes);
 }
 const buffer=Buffer.concat(pieces);
 if(createHash('sha256').update(buffer).digest('hex')!==UV_SHA)
  throw Error('Official uv release SHA256 failed');
 const exe=checkZipEntry(buffer,'uv.exe');
 await fsp.mkdir(path.dirname(p.uv),{recursive:true});
 const tmp=p.uv+'.partial';
 await fsp.writeFile(tmp,exe);
 await fsp.rename(tmp,p.uv);
}
async function runExecutable(exe,args,p,onMessage=()=>{},timeout=40*60*1000){
 const env=childEnvironment(p);
 return await new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{shell:false,cwd:p.base,windowsHide:true,
    env,stdio:['ignore','pipe','pipe']});
  let last='',finished=false;
  const killTimer=setTimeout(()=>{
    child.kill(); // only managed child, not the NOTIQ renderer
  },timeout);
  for(const pipe of [child.stdout,child.stderr])
   pipe.on('data',chunk=>{
    last=(last+String(chunk)).slice(-3000);
    onMessage(String(chunk).replace(/[\\r\\n]+/g,' ').slice(-220));
   });
  child.on('error',err=>{if(!finished){finished=true;clearTimeout(killTimer);reject(err)}});
  child.on('close',code=>{
    if(finished)return;
    finished=true;clearTimeout(killTimer);
    code===0?resolve(last):reject(Error('Piano engine process exited '+code+': '+last.slice(-1000)));
  });
 });
}
async function installed(p){
 if(!fs.existsSync(p.python)||!fs.existsSync(p.runner))return false;
 try {
  const log=await runExecutable(p.python,[p.runner,'--self-test'],p,()=>{},120000);
  return log.includes('NOTIQ_TRANSKUN_V2_READY');
 }catch{return false}
}
async function setup(dataDir,runnerSource,onProgress=()=>{},fetchImpl=fetch){
 const p=localPaths(dataDir);
 if(await installed(p))return {ready:true,installedAlready:true};
 for(const d of [p.base,p.temp,p.cache,p.pythons])await fsp.mkdir(d,{recursive:true});
 onProgress('Tải trình quản lý Python xác minh SHA256 vào ổ ứng dụng');
 await fetchUvBinary(p,fetchImpl);
 onProgress('Cài đặt Python 3.11 riêng trong NOTIQ-Data (không sửa hệ thống)');
 await runExecutable(p.uv,['venv','--python','3.11','--managed-python',p.venv],p,onProgress);
 onProgress('Cài PyTorch CPU và checkpoint Transkun V2 từ PyPI (có thể lớn hơn 1GB)');
 await runExecutable(p.uv,['pip','install','--python',p.python,...PIP_REQUIREMENTS],p,onProgress);
 await fsp.writeFile(p.runner,runnerSource,{encoding:'utf8'});
 onProgress('Đang xác minh checkpoint Piano V2 thực');
 if(!await installed(p))throw Error('Transkun V2 installation did not pass self-test');
 return {ready:true,installedAlready:false};
}
async function transcribe(dataDir,wavBytes,runnerSource,onProgress=()=>{}){
 const p=localPaths(dataDir);
 if(!await installed(p))throw Error('Transkun V2 chưa được cài đặt. Nhấn Cài AI Piano trước.');
 if(!wavBytes||wavBytes.length<44||wavBytes.length>15*60*16000*4+44)
  throw Error('Invalid WAV input size for Transkun V2');
 const jobs=path.join(p.base,'jobs');
 await fsp.mkdir(jobs,{recursive:true});
 const dir=await fsp.mkdtemp(path.join(jobs,'job-'));
 const input=path.join(dir,'audio.wav'),output=path.join(dir,'notes.json');
 try{
  await fsp.writeFile(input,wavBytes);
  await fsp.writeFile(p.runner,runnerSource,{encoding:'utf8'});
  onProgress('Đang nhận diện Piano bằng Transkun V2 CPU');
  await runExecutable(p.python,[p.runner,'--input',input,'--output',output],p,onProgress,60*60*1000);
  const result=JSON.parse(await fsp.readFile(output,'utf8'));
  if(result?.schema!==1||result?.engine!=='transkun-v2'||!Array.isArray(result.notes))
   throw Error('Transkun V2 output schema invalid');
  return result;
 }finally{await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
module.exports={UV_URL,UV_SHA,checkZipEntry,localPaths,setup,installed,transcribe};
