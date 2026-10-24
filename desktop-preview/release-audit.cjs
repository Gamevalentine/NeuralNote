'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PE64=0x8664;
const ASAR_MODULES=[
 'main.cjs','preload.cjs','models.cjs','model-download.cjs',
 'native-progress.cjs','process-metrics.cjs','full-song-health.cjs','acceptance-5pb.cjs',
 'benchmark-native.cjs','wav-benchmark.cjs','cpu-threads.cjs',
 'transkun-runtime.cjs','transkun-runner.py','www/index.html'
];
function sha256(file){
 const h=crypto.createHash('sha256');
 const fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);
 try{for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);
   if(!n)break;h.update(buffer.subarray(0,n));}}
 finally{fs.closeSync(fd);}
 return h.digest('hex');
}
function isX64PE(file){
 const fd=fs.openSync(file,'r'),buf=Buffer.alloc(0x200);
 try{const bytes=fs.readSync(fd,buf,0,buf.length,0);
  if(bytes<0x90||buf.toString('ascii',0,2)!=='MZ')return false;
  const start=buf.readUInt32LE(0x3c);
  return start+6<=bytes&&buf.toString('ascii',start,start+4)==='PE\x00\x00'&&
    buf.readUInt16LE(start+4)===PE64;}
 finally{fs.closeSync(fd);}
}
function inspectPortable(root,{asar}= {}){
 const file=p=>path.join(root,...p.split('/'));
 const paths={
  app:file('NOTIQ-Stage5-FullSong.exe'),
  cli:file('resources/bridge-bin/notiq-muscriptor-cli.exe'),
  archive:file('resources/app.asar')
 };
 for(const [name,p] of Object.entries(paths))
  if(!fs.existsSync(p)||!fs.statSync(p).isFile())throw Error('Missing '+name+': '+p);
 if(!isX64PE(paths.app)||!isX64PE(paths.cli))
  throw Error('Not valid Windows x64 EXE / native CLI.');
 if(!asar||typeof asar.extractFile!=='function')throw Error('Missing trusted Electron ASAR parser.');
 for(const fileName of ASAR_MODULES){
  let content;
  try{content=asar.extractFile(paths.archive,fileName)}catch{
   throw Error('Electron ASAR missing required file: '+fileName);}
  if(!content?.length)throw Error('Electron ASAR file empty: '+fileName);
 }
 const modelDir=file('models');
 if(fs.existsSync(modelDir)&&fs.readdirSync(modelDir).some(n=>/\.gguf$/i.test(n)))
  throw Error('Model weights must not be embedded in the small portable preview.');
 const html=asar.extractFile(paths.archive,'www/index.html').toString('utf8');
 if(!html.includes('assets/'))throw Error('Compiled renderer asset reference missing.');
 const manifest={
  schema:'notiq-5p-portable-audit-v1',
  status:'QA_PREVIEW_ONLY',
  releaseApproved:false,
  reviewRequired:['Large 2.74GB real 4–6min audio on 16GB Windows device',
   'native process RAM and checkpoint/resume evidence','note F1 vs same-performance MIDI',
   'human playback review of velocity and pedal'],
  modelWeightsIncluded:false,
  files:Object.fromEntries(Object.entries(paths).map(([key,p])=>[
   key,{path:path.relative(root,p).replaceAll('\\','/'),bytes:fs.statSync(p).size,sha256:sha256(p)}
  ])),
  requiredAsarFiles:ASAR_MODULES,
 };
 return manifest;
}
if(require.main===module){
 try{
  const root=process.argv[2];
  if(!root)throw Error('Expected portable app directory');
  const asar=require(path.resolve('package-tools/node_modules/@electron/asar'));
  const report=inspectPortable(path.resolve(root),{asar});
  fs.writeFileSync(path.join(path.resolve(root),'NOTIQ-5P-INTEGRITY.json'),
   JSON.stringify(report,null,2)+'\n');
  console.log('NOTIQ_STAGE5P_PORTABLE_AUDIT_PASS',JSON.stringify({
    approved:report.releaseApproved,asarmodules:report.requiredAsarFiles.length,
    binaryHashes:Object.values(report.files).map(x=>x.sha256)
  }));
 }catch(e){console.error('NOTIQ_STAGE5P_PORTABLE_AUDIT_FAIL',e.message);process.exitCode=1}
}
module.exports={sha256,isX64PE,inspectPortable,ASAR_MODULES};
