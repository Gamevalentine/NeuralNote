'use strict';
// Replace only the www/ renderer inside the verified Stage5 portable Electron ASAR.
// Keep native CLI and all other packaged application files unmodified.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const asar=require(path.resolve('package-tools/node_modules/@electron/asar'));
const [archive,dist]=process.argv.slice(2);
if(!archive || !dist)throw Error('Need existing app.asar and verified web/dist paths');
const old=path.resolve(archive),fresh=path.resolve(dist);
if(!fs.existsSync(old)||!fs.statSync(old).isFile())throw Error('Original app.asar does not exist');
if(!fs.existsSync(path.join(fresh,'index.html')))throw Error('Web app was not built');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'notiq-stage5d-ui-'));
const staged=old+'.5d';
(async()=>{
 try{
  asar.extractAll(old,temp);
  const dest=path.join(temp,'www');
  if(!fs.existsSync(dest))throw Error('Prior app.asar does not contain www/');
  fs.rmSync(dest,{recursive:true,force:true});
  fs.cpSync(fresh,dest,{recursive:true});
  if(!fs.existsSync(path.join(dest,'index.html')))throw Error('NOTIQ 5D renderer missing');
  await asar.createPackage(temp,staged);
  if(fs.statSync(staged).size<100000)throw Error('Unexpectedly small repacked ASAR');
  fs.renameSync(staged,old);
  console.log('NOTIQ_ASAR_5D_REPLACED',JSON.stringify({archive:old,assets:fs.readdirSync(dest).length,bytes:fs.statSync(old).size}));
 }finally{
  fs.rmSync(temp,{recursive:true,force:true});
  if(fs.existsSync(staged))fs.rmSync(staged,{force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
