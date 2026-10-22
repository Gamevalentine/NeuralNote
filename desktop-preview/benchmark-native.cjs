'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createNativeProgressParser}=require('./native-progress.cjs');
const {createProcessSampler}=require('./process-metrics.cjs');
const {makeClip}=require('./wav-benchmark.cjs');
const {cpuThreadCount,fingerprintPCM}=require('./cpu-threads.cjs');
const {createHash}=require('node:crypto');
const now=()=>Number(process.hrtime.bigint()/1000000n);
const round=x=>Math.round(x);
async function runBenchmark({wav,seconds,startSeconds=0,threads=2,model,modelPath,bridgeBinary,dataDir,
  verifyModel,onProgress,job,runProcess=spawn,sampleProcess=createProcessSampler}){
 const nThreads=cpuThreadCount(threads);
 const clip=makeClip(wav,seconds,startSeconds); // bounds and format validated before disk write.
 const pcmSha256=fingerprintPCM(clip);
 if(job.cancelled)throw Error('Đã hủy benchmark.');
 const start=now();
 onProgress('Đang xác minh checksum model trên ổ đã chọn…',0);
 const verified=await verifyModel(model,modelPath);
 const checksumMs=now()-start;
 if(!verified)throw Error('Model GGUF chưa được xác minh; hãy tải lại model chính thức.');
 if(job.cancelled)throw Error('Đã hủy benchmark sau kiểm tra model.');
 const root=path.join(dataDir,'benchmark-temp');
 await fs.mkdir(root,{recursive:true});
 const work=await fs.mkdtemp(path.join(root,'clip-'));
 try{
  const input=path.join(work,'input.wav'),output=path.join(work,'notes.json');
  const writeAt=now();
  await fs.writeFile(input,clip);
  const wavWriteMs=now()-writeAt;
  if(job.cancelled)throw Error('Đã hủy benchmark.');
  const spawnAt=now();
  const results=await new Promise((resolve,reject)=>{
   let settled=false,stderr='',loadAt=null,firstInferenceProgressAt=null,modelProgress=0;
   const child=runProcess(bridgeBinary,[input,modelPath,output,'--threads='+nThreads],{
    cwd:work,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']
   });
   job.child=child;
   // This instrumentation only follows the CLI started by NOTIQ. It samples
   // RAM/CPU on this machine and does not send any metrics to a server.
   const monitor=child.pid?sampleProcess(child.pid):null;
   const parser=createNativeProgressParser(percent=>{
    modelProgress=percent;
    if(percent>=20&&!loadAt){loadAt=now();onProgress('Nạp model hoàn tất; bắt đầu suy luận CPU…',percent);}
    else if(percent>20&&!firstInferenceProgressAt)firstInferenceProgressAt=now();
    onProgress('MuScriptor '+model.label+' báo '+percent+'% — số liệu thật từ CLI.',percent);
   });
   const finish=async(error,code)=>{
    if(settled)return;
    settled=true;
    const endAt=now();
    let stats={samples:0,peakWorkingSetBytes:null,machineCpuPercent:null,
      cpuCoreEquivalent:null,logicalCores:null};
    if(monitor)stats=await monitor.stop();
    if(job.cancelled){reject(Error('Đã dừng benchmark theo yêu cầu; không thay MIDI hiện tại.'));return;}
    if(error){reject(error);return;}
    if(code!==0){reject(Error('MuScriptor benchmark lỗi mã '+code+': '+stderr.slice(-850)));return;}
    try{
     const data=JSON.parse(await fs.readFile(output,'utf8'));
     if(data?.schema!==1||data?.engine!=='muscriptor'||!Array.isArray(data.notes)||
        data.notes.length>150000)throw Error('Native output không hợp lệ.');
     resolve({
      schema:1,engine:'muscriptor',model:model.id,modelLabel:model.label,
      clipSeconds:seconds,startSeconds,audioBytes:clip.length,pcmSha256,
      checksumMs,writeMs:wavWriteMs,
      nativeTotalMs:endAt-spawnAt,
      loadMs:loadAt===null?null:loadAt-spawnAt,
      inferenceMs:loadAt===null?null:endAt-loadAt,
      firstInferenceUpdateMs:firstInferenceProgressAt===null?null:firstInferenceProgressAt-spawnAt,
      notes:data.notes.length,
      notesSha256:createHash('sha256').update(JSON.stringify(data.notes)).digest('hex'),
      peakWorkingSetBytes:stats.peakWorkingSetBytes,
      machineCpuPercent:stats.machineCpuPercent,
      cpuCoreEquivalent:stats.cpuCoreEquivalent,
      cpuSamples:stats.samples,logicalCores:stats.logicalCores,
      sampleSource:'Windows Get-Process PID',
      measurement:'CPU/RAM riêng tiến trình MuScriptor; không phải số liệu của cả NOTIQ',
      threadCount:nThreads,
      actualFullSongEstimateMs:null,
      wallRecordedAt:new Date().toISOString()
     });
    }catch(cause){reject(cause);}
   };
   child.stderr.on('data',chunk=>{const value=String(chunk);stderr=(stderr+value).slice(-5000);parser.push(value);});
   child.stdout.on('data',()=>{});
   child.once('error',error=>void finish(error,null));
   child.once('close',code=>void finish(null,code));
   if(job.cancelled&&!child.killed)child.kill();
  });
  return results;
 }finally{
  await fs.rm(work,{force:true,recursive:true}).catch(()=>{});
 }
}
module.exports={runBenchmark};
