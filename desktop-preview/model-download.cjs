'use strict';
// Verified streaming GGUF installer. Keep partial downloads to resume network failures.
// No weights are ever read wholly into JS memory or stored under the Windows C: drive.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
async function sha256File(filename) {
  const hash=createHash('sha256');
  for await(const data of fs.createReadStream(filename))hash.update(data);
  return hash.digest('hex').toLowerCase();
}
async function hasVerifiedModel(model,filename) {
  try {
    const stat=await fsp.stat(filename);
    return stat.isFile()&&stat.size===model.bytes&&(await sha256File(filename))===model.sha256;
  } catch {return false}
}
async function downloadVerifiedModel(model,dest,onProgress=()=>{},fetchImpl=fetch) {
  if(await hasVerifiedModel(model,dest))return {alreadyInstalled:true};
  await fsp.mkdir(path.dirname(dest),{recursive:true});
  const partial=dest+'.partial';
  let previous=0;
  try {previous=(await fsp.stat(partial)).size} catch {}
  if(previous>model.bytes) {await fsp.rm(partial,{force:true});previous=0}
  // Hash the existing bytes and append only after the server has honored Range.
  let response=await fetchImpl(model.url,{redirect:'follow',headers:previous?{Range:'bytes='+previous+'-'}:{}});
  if(!response.ok||!response.body)throw Error('Máy chủ tải GGUF trả về HTTP '+response.status);
  if(/text\/html/i.test(response.headers.get('content-type')||''))throw Error('Máy chủ không trả về GGUF');
  const acceptsRange=response.status===206 &&
    response.headers.get('content-range')?.startsWith('bytes '+previous+'-');
  if(response.status===206&&!acceptsRange)throw Error('Máy chủ trả về Content-Range sai vị trí, từ chối ghép file');
  if(!acceptsRange) {
    if(response.status!==200)throw Error('Máy chủ trả về HTTP '+response.status+' không hợp lệ');
    previous=0; // Server did not honor Range: overwrite, never append an invalid checkpoint.
  }
  const hash=createHash('sha256');
  if(previous)for await(const data of fs.createReadStream(partial,{start:0,end:previous-1}))hash.update(data);
  let received=previous,previousPercent=-1;
  const checker=new Transform({
    transform(chunk,_encoding,next) {
      received+=chunk.length;
      if(received>model.bytes)return next(Error('GGUF vượt dung lượng bản đã ghim'));
      hash.update(chunk);
      const pct=Math.floor(received/model.bytes*100);
      if(pct!==previousPercent){previousPercent=pct;onProgress(pct,received,model.bytes)}
      next(null,chunk);
    }
  });
  // On transient network failures, keep the partial file on the chosen app drive.
  await pipeline(Readable.fromWeb(response.body),checker,fs.createWriteStream(partial,{flags:previous?'a':'w'}));
  if(received!==model.bytes)throw Error('GGUF tải chưa đầy đủ: '+received+' / '+model.bytes+' bytes; có thể tải tiếp');
  if(hash.digest('hex').toLowerCase()!==model.sha256){
    await fsp.rm(partial,{force:true});
    throw Error('SHA-256 không khớp bản GGUF gốc, đã xóa bản tải lỗi');
  }
  await fsp.rename(partial,dest);
  onProgress(100,model.bytes,model.bytes);
  return {alreadyInstalled:false};
}
module.exports={sha256File,hasVerifiedModel,downloadVerifiedModel};
