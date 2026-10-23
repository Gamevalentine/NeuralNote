import type {BenchmarkResult} from './nativeBenchmark';

export type TrialThread=2|4|6;
export type TrialGate={
  threads:TrialThread; samples:number; inferenceMedianMs:number|null;
  baselineMedianMs:number|null; speedup:number|null;
  peakRamBytes:number|null; outputIdentical:boolean|null;
  status:'pending'|'candidate'|'reject'; reasons:string[];
};
export type Audit={
  status:'insufficient'|'candidate'|'risk'; summary:string; gates:TrialGate[];
  excerptFingerprint:string|null; notesCompared:boolean;
};
/** Evidence from local benchmark runs only, no assumed 5-minute acceleration.
 * Minimum two repeats per choice; baseline and comparison must use the exact PCM.
 * Hash equality ensures MIDI data equality for the test clip, not accuracy against a score.
 */
export function auditCpuTrials(trials:BenchmarkResult[],model:string,seconds:20|30|60,offset:number):Audit{
 const pool=trials.filter(t=>t.model===model&&t.clipSeconds===seconds&&
  t.startSeconds===offset&&/^[a-f0-9]{64}$/.test(t.pcmSha256)&&
  [2,4,6].includes(t.threadCount)&&t.inferenceMs!==null&&t.inferenceMs>0&&
  Number.isFinite(t.inferenceMs)&&t.notesSha256?.length===64);
 const fingerprints=[...new Set(pool.map(t=>t.pcmSha256))];
 // Never compare entries from different audio decoding outputs, even same filename.
 if(fingerprints.length!==1)return{
  status:'insufficient',summary:fingerprints.length>1
   ?'Các lần đo không cùng dữ liệu PCM; phải thử lại đúng một nguồn âm thanh.'
   :'Cần dữ liệu benchmark thật cùng đoạn và model.',gates:[],excerptFingerprint:null,notesCompared:false
 };
 // A saved JSON imported twice is still one observation, not two independent CPU tests.
 const distinct=new Set<string>();
 const same=pool.filter(t=>{
  if(t.pcmSha256!==fingerprints[0])return false;
  const signature=[t.threadCount,t.wallRecordedAt,t.inferenceMs,t.notesSha256].join(':');
  if(distinct.has(signature))return false;
  distinct.add(signature);return true;
 });
 const median=(n:number[])=>{if(!n.length)return null;const sorted=n.slice().sort((a,b)=>a-b);return sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2};
 const runs=(threads:TrialThread)=>same.filter(t=>t.threadCount===threads);
 const baseline=runs(2),baseTime=median(baseline.map(t=>t.inferenceMs!));
 const baseHashes=new Set(baseline.map(t=>t.notesSha256));
 const gates=([2,4,6] as TrialThread[]).map(threads=>{
  const values=runs(threads);
  const inferenceMedianMs=median(values.map(t=>t.inferenceMs!));
  const peaks=values.map(t=>t.peakWorkingSetBytes).filter((n):n is number=>n!==null&&n>0);
  const peakRamBytes=peaks.length?Math.max(...peaks):null;
  const basePeaks=baseline.map(t=>t.peakWorkingSetBytes).filter((n):n is number=>n!==null&&n>0);
  const baselinePeak=basePeaks.length?Math.max(...basePeaks):null;
  const speedup=baseTime&&inferenceMedianMs?baseTime/inferenceMedianMs:null;
  const reasons:string[]=[];
  if(values.length<2)reasons.push('Cần ít nhất 2 lần đo độc lập mức '+threads+' luồng');
  if(baseline.length<2)reasons.push('Thiếu 2 lượt mốc 2 luồng');
  const hashes=new Set(values.map(t=>t.notesSha256));
  const outputIdentical=values.length>=2&&baseline.length>=2?
    hashes.size===1&&baseHashes.size===1&&[...hashes][0]===[...baseHashes][0]:null;
  if(outputIdentical===false)reasons.push('Nốt MIDI khác mốc 2 luồng; chưa xác nhận chất lượng');
  if(!peakRamBytes||!baselinePeak)reasons.push('Chưa đo đủ RAM đỉnh');
  if(threads!==2&&speedup!==null&&speedup<1.1)
    reasons.push('Tăng tốc chưa đạt 10% trên cùng đoạn');
  if(threads!==2&&peakRamBytes&&baselinePeak&&peakRamBytes>baselinePeak*1.3)
    reasons.push('RAM tăng trên 30% so với mốc 2 luồng');
  const ready=threads!==2&&values.length>=2&&baseline.length>=2&&
    outputIdentical===true&&peakRamBytes!==null&&baselinePeak!==null&&
    speedup!==null&&speedup>=1.1&&peakRamBytes<=baselinePeak*1.3;
  return{threads,samples:values.length,inferenceMedianMs,baselineMedianMs:baseTime,
    speedup,peakRamBytes,outputIdentical,
    status:ready?'candidate':values.length>=2&&baseline.length>=2?'reject':'pending',
    reasons} as TrialGate;
 });
 const hasCandidate=gates.some(t=>t.status==='candidate');
 const hasRisk=gates.some(t=>t.status==='reject');
 return{status:hasCandidate?'candidate':hasRisk?'risk':'insufficient',
   summary:hasCandidate?'Có cấu hình đáng thử trên đoạn này; chưa chứng minh tốt hơn trên toàn bài.'
    :hasRisk?'Đã đủ số lượt đo nhưng chưa đạt tiêu chí tăng tốc/RAM/nốt.'
    :'Cần lặp lại mỗi mức tối thiểu 2 lần trên cùng nguồn âm thanh.',
   gates,excerptFingerprint:fingerprints[0],
   notesCompared:baseline.length>=2};
}
export function validateFullSongEvidence(referencePresent:boolean,baselinePresent:boolean,baselineF1:number|null,currentF1:number|null,
  sameAudioConfirmed:boolean):{status:'missing'|'risk'|'comparable';explanation:string;deltaF1:number|null}{
 if(!referencePresent||!baselinePresent||!sameAudioConfirmed||baselineF1===null||currentF1===null)
  return{status:'missing',explanation:'Cần MIDI chuẩn, MIDI 5L cũ và xác nhận chúng thuộc đúng cùng bản ghi để đối chiếu F1.',deltaF1:null};
 const delta=Math.round((currentF1-baselineF1)*10000)/100;
 return{status:delta<0?'risk':'comparable',
   explanation:delta<0?'F1 giảm so với 5L; không đạt tiêu chí không suy giảm chất lượng.'
    :'Có số liệu F1 cùng MIDI chuẩn. Cần nghe và đối chiếu nốt ở ranh giới nữa.',
   deltaF1:delta};
}

/** Import only NOTIQ's own compact benchmark JSON; never execute file contents. */
export function parseSavedBenchmark(data:unknown):BenchmarkResult{
 if(!data||typeof data!=='object')throw Error('Tệp không phải báo cáo benchmark JSON.');
 const r=data as Record<string,unknown>;
 if(r.schema!==1||r.engine!=='muscriptor'||!['small','large'].includes(String(r.model))||
    ![2,4,6].includes(Number(r.threadCount))||
    ![20,30,60].includes(Number(r.clipSeconds))||
    !Number.isFinite(Number(r.startSeconds))||Number(r.startSeconds)<0||Number(r.startSeconds)>900||
    !/^[a-f0-9]{64}$/.test(String(r.pcmSha256))||
    !/^[a-f0-9]{64}$/.test(String(r.notesSha256))||
    !Number.isFinite(Number(r.inferenceMs))||Number(r.inferenceMs)<=0||
    !Number.isFinite(Number(r.nativeTotalMs))||Number(r.nativeTotalMs)<=0||
    typeof r.wallRecordedAt!=='string'||!Number.isFinite(Date.parse(r.wallRecordedAt))||
    typeof r.modelLabel!=='string')
    throw Error('Báo cáo không đúng định dạng NOTIQ 5M-B hoặc thiếu số liệu đo thật.');
 if(r.peakWorkingSetBytes!==null &&
    (!Number.isFinite(Number(r.peakWorkingSetBytes))||Number(r.peakWorkingSetBytes)<=0))
    throw Error('Thông số RAM trong báo cáo không hợp lệ.');
 return r as unknown as BenchmarkResult;
}
