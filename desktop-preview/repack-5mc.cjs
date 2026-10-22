'use strict';
// Stage 5M-C packaging replaces only the Electron JS/UI. The verified native
// MuScriptor executable is untouched; Python/Transkun are downloaded opt-in.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const asar=require(path.resolve('package-tools/node_modules/@electron/asar'));
const [archive,dist]=process.argv.slice(2);
if(!archive||!dist)throw Error('Missing existing ASAR / verified NOTIQ Web build');
const target=path.resolve(archive),renderer=path.resolve(dist);
if(!fs.statSync(target).isFile()||!fs.existsSync(path.join(renderer,'index.html')))throw Error('Missing packaged application');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'notiq-transkun-v2-'));
const output=target+'.stage5mc';
(async()=>{
 try{
  asar.extractAll(target,work);
  const html=path.join(work,'www');
  if(!fs.existsSync(html))throw Error('NOTIQ app.asar is missing previous renderer');
  fs.rmSync(html,{recursive:true,force:true});
  fs.cpSync(renderer,html,{recursive:true});
  for(const name of ['main.cjs','preload.cjs','models.cjs','model-download.cjs',
      'transkun-runtime.cjs','transkun-runner.py','native-progress.cjs',
      'process-metrics.cjs','wav-benchmark.cjs','benchmark-native.cjs','cpu-threads.cjs']){
    const src=path.resolve('desktop-preview',name);
    if(!fs.existsSync(src))throw Error('Missing new adapter: '+name);
    fs.copyFileSync(src,path.join(work,name));
  }
  await asar.createPackage(work,output);
  if(fs.statSync(output).size<200000)throw Error('Packaged app is too small');
  fs.rmSync(target,{force:true});
  fs.renameSync(output,target);
  console.log('NOTIQ_STAGE5MC_WINDOWS_PACKAGED',JSON.stringify({
    asar:target,bytes:fs.statSync(target).size,
    engines:['MuScriptor Small/Large','Transkun V2 Piano opt-in'],
    pythonAndWeightsIncluded:false
  }));
 }finally{fs.rmSync(work,{recursive:true,force:true});
  if(fs.existsSync(output))fs.rmSync(output,{force:true})}
})().catch(err=>{console.error(err);process.exitCode=1});
