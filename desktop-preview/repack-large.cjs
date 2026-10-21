'use strict';
// Stage 5F: package only approved Electron UI/bridge files from this commit.
// Keep the previously self-tested native CLI binary unchanged. No model weights bundled.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const asar=require(path.resolve('package-tools/node_modules/@electron/asar'));
const [archive,dist]=process.argv.slice(2);
if(!archive||!dist)throw Error('Need existing ASAR and compiled web/dist');
const target=path.resolve(archive),renderer=path.resolve(dist);
if(!fs.statSync(target).isFile()||!fs.existsSync(path.join(renderer,'index.html')))throw Error('Missing built assets');
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'notiq-5f-large-'));
const staging=target+'.5f';
(async()=>{
 try {
  asar.extractAll(target,workspace);
  const site=path.join(workspace,'www');
  if(!fs.existsSync(site))throw Error('Existing NOTIQ Electron application missing www/');
  fs.rmSync(site,{recursive:true,force:true});
  fs.cpSync(renderer,site,{recursive:true});
  for(const filename of ['main.cjs','preload.cjs','models.cjs','model-download.cjs']) {
    const original=path.resolve('desktop-preview',filename);
    if(!fs.existsSync(original))throw Error('Missing updated native bridge '+filename);
    fs.copyFileSync(original,path.join(workspace,filename));
  }
  if(!fs.existsSync(path.join(workspace,'models.cjs')))throw Error('Large registry missing');
  await asar.createPackage(workspace,staging);
  if(fs.statSync(staging).size<100000)throw Error('Packaged NOTIQ application unexpectedly small');
  fs.rmSync(target,{force:true});
  fs.renameSync(staging,target);
  console.log('NOTIQ_STAGE5F_LARGE_PACKAGED',JSON.stringify({
    archive:target,size:fs.statSync(target).size,models:'Small + Large',weightsBundled:false
  }));
 }finally{
  fs.rmSync(workspace,{recursive:true,force:true});
  if(fs.existsSync(staging))fs.rmSync(staging,{force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
