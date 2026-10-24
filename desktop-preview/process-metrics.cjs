'use strict';
const {execFile}=require('node:child_process');
const os=require('node:os');
function parseWindowsSample(text){
 const found=/^\s*([0-9]+(?:[.,][0-9]+)?)\|([0-9]+)\|([0-9]+)\s*$/.exec(String(text));
 if(!found)return null;
 const cpuSeconds=Number(found[1].replace(',','.'));
 const workingSetBytes=Number(found[2]),peakWorkingSetBytes=Number(found[3]);
 if(![cpuSeconds,workingSetBytes,peakWorkingSetBytes].every(Number.isFinite)||cpuSeconds<0||
     workingSetBytes<0||peakWorkingSetBytes<0)return null;
 return {cpuSeconds,workingSetBytes,peakWorkingSetBytes};
}
function windowsProcessSample(pid){
 if(process.platform!=='win32'||!Number.isSafeInteger(pid)||pid<=0)
  return Promise.resolve(null);
 const cmd='$p=Get-Process -Id '+pid+' -ErrorAction Stop;'+
  ' $cpu=[Convert]::ToString([double]$p.CPU,[Globalization.CultureInfo]::InvariantCulture);'+
  ' [Console]::WriteLine($cpu+\'|\'+$p.WorkingSet64+\'|\'+$p.PeakWorkingSet64)';
 return new Promise(resolve=>{
  execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{
   windowsHide:true,timeout:6000,maxBuffer:2048
  },(error,stdout)=>resolve(error?null:parseWindowsSample(stdout)));
 });
}
/** Sample CPU and peak working set of just the native CLI. No user CMD or global telemetry. */
function createProcessSampler(pid,sample=windowsProcessSample,logicalCores=os.cpus().length){
 let ended=false,busy=false,readings=0,peak=0,first=null,last=null;
 const tick=async()=>{
  if(ended||busy)return;
  busy=true;
  try{
   const snap=await sample(pid);
   if(ended||!snap)return;
   const reading={...snap,at:Date.now()};
   if(!first)first=reading;
   last=reading;readings++;
   peak=Math.max(peak,snap.peakWorkingSetBytes,snap.workingSetBytes);
  }catch{ /* diagnostics optional; never block or disrupt transcription */ }
  finally{busy=false}
 };
 const timer=setInterval(()=>{void tick()},4000);
 void tick();
 const snapshot=()=>{
  const cpuCoreEquivalent=first&&last&&last.at>first.at
    ?Math.max(0,(last.cpuSeconds-first.cpuSeconds)/((last.at-first.at)/1000))
    :null;
  return {
    samples:readings,lastWorkingSetBytes:last?.workingSetBytes??null,
    peakWorkingSetBytes:readings?peak:null,
    cpuCoreEquivalent:cpuCoreEquivalent===null?null:Math.round(cpuCoreEquivalent*100)/100,
    machineCpuPercent:cpuCoreEquivalent!==null&&logicalCores>0
      ?Math.round(cpuCoreEquivalent/logicalCores*1000)/10:null,
    logicalCores,lastSampleAt:last?.at??null
  };
 };
 return {
  snapshot,
  async stop(){
   clearInterval(timer);
   if(!ended)await tick();
   ended=true;
   const {samples,peakWorkingSetBytes,cpuCoreEquivalent,machineCpuPercent,logicalCores}=snapshot();
   return {samples,peakWorkingSetBytes,cpuCoreEquivalent,machineCpuPercent,logicalCores};
  },
 };
}
module.exports={parseWindowsSample,windowsProcessSample,createProcessSampler};
