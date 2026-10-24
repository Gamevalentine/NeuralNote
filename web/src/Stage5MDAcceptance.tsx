import {useMemo,useState} from 'react';
import type {Note} from './audio';
import type {BenchmarkResult} from './nativeBenchmark';
import {auditCpuTrials,parseSavedBenchmark,validateFullSongEvidence} from './stage5mdAudit';
import {readReferenceMidi,scoreAgainstReference,type MidiReference,type MusicMode,type NoteScore} from './referenceBenchmark';
import {convertAudioToNativeWav} from './muscriptorNative';
type Props={
 trials:BenchmarkResult[];clipSeconds:20|30|60;clipOffset:number;
 model:'small'|'large';notes:Note[];referenceMidi:MidiReference|null;
 musicMode:MusicMode;referenceOffset:number;songDuration:number;busy:boolean;
 onImportBenchmarks:(reports:BenchmarkResult[])=>void;
};
const pct=(n:number|null)=>n===null?'Chưa đo':(n*100).toFixed(1)+'%';
const sec=(ms:number|null)=>ms===null?'Chưa đo':(ms/1000).toFixed(1)+' giây';
const ram=(bytes:number|null)=>bytes===null?'Chưa đo':(bytes/1024**3).toFixed(2)+' GiB';
export function Stage5MDAcceptance(p:Props){
 const [oldMidi,setOldMidi]=useState<MidiReference|null>(null);
 const [oldError,setOldError]=useState('');
 const [sameRecording,setSameRecording]=useState(false);
 const [completed,setCompleted]=useState(false);
 const [resumed,setResumed]=useState(false);
 const [seamsChecked,setSeamsChecked]=useState(false);
 const [exportStatus,setExportStatus]=useState('');
 const [importStatus,setImportStatus]=useState('');
 const [realEvidence,setRealEvidence]=useState<{
  status:string;sourceCount:number;validNativeRuns:number;loadedReports:number;
  blockers:string[];warnings:string[];
  performance:{audioSha256:string;measurements:{
   threads:number;seconds:number;peakNativeGiB:number;notes:number;resumed:boolean
  }[]}[];
 }|null>(null);
 const [realError,setRealError]=useState('');
 const [finalQualityFiles,setFinalQualityFiles]=useState<Record<string,unknown>[]>([]);
 const [finalImportError,setFinalImportError]=useState('');
 const [finalReviewFlags,setFinalReviewFlags]=useState({
   ownPlaybackReviewed:false,velocityPedalReviewed:false,
   deviceResponsive:false,checkpointBoundaryChecked:false
 });
 const [finalResult,setFinalResult]=useState<{
   status:'HOLD'|'READY_FOR_OWNER_REVIEW';releaseApproved:false;
   blockers:string[];warnings:string[];independentSongs:number;
   nativeRunsAccepted:number;qualityPacketsAccepted:number;qualityPacketsRejected:number;
   sourceBuildPass:boolean;portableIntegrityPass:boolean;windowsLaunchVerified:boolean
 }|null>(null);
 const [finalBusy,setFinalBusy]=useState(false);
 const loadQualityFiles=async(files:FileList|null)=>{
   if(!files?.length)return;
   setFinalResult(null);setFinalImportError('');setFinalQualityFiles([]);
   if(files.length>8){setFinalImportError('Chỉ nhận tối đa 8 báo cáo MIDI.');return;}
   try{
     const parsed:Record<string,unknown>[]=[];
     for(const file of Array.from(files)){
       if(!file.name.toLowerCase().endsWith('.json')||file.size<30||file.size>24000)
         throw Error('Chỉ nhận báo cáo JSON tối đa 24 KB mỗi tệp.');
       const candidate=JSON.parse(await file.text());
       if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
          candidate.schema!=='notiq-5pc-quality-v1')
         throw Error('Báo cáo MIDI không có định dạng 5P-C. Không thể dùng báo cáo đo CPU thay thế.');
       parsed.push(candidate);
     }
     setFinalQualityFiles(parsed);
   }catch(error){setFinalImportError(error instanceof Error?error.message:'Báo cáo không hợp lệ.');}
 };
 const inspectFinalReview=async()=>{
   setFinalBusy(true);setFinalResult(null);setFinalImportError('');
   try{
     if(!window.notiqNative?.finalReview)throw Error('Bản Windows chưa hỗ trợ 5P-C.');
     setFinalResult(await window.notiqNative.finalReview({
       comparisons:finalQualityFiles,review:finalReviewFlags
     }));
   }catch(error){setFinalImportError(error instanceof Error?error.message:'Không kiểm tra được nghiệm thu 5P-C.');}
   finally{setFinalBusy(false);}
 };
 const saveFinalReview=()=>{
   if(!finalResult)return;
   const summary={...finalResult,
     note:'Đây là báo cáo thẩm định, không phải giấy phép phát hành; không chứa audio, MIDI thô hoặc đường dẫn.'};
   const url=URL.createObjectURL(new Blob([JSON.stringify(summary,null,2)],{type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download='NOTIQ-5PC-Danh-gia-phat-hanh.json';
   document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),250);
 };
 const inspectRealEvidence=async()=>{
  setRealError('');
  try{
   if(!window.notiqNative?.acceptanceEvidence)throw Error('Chỉ có trên bản NOTIQ Windows 5P-B.');
   setRealEvidence(await window.notiqNative.acceptanceEvidence());
  }catch(cause){setRealError(cause instanceof Error?cause.message:'Không đọc được báo cáo 5P-B.')}
 };
 const perf=useMemo(()=>auditCpuTrials(p.trials,p.model,p.clipSeconds,p.clipOffset),
  [p.trials,p.model,p.clipSeconds,p.clipOffset]);
 const quality=useMemo(()=>{
  if(!p.referenceMidi||!oldMidi||!p.notes.length)return{old:null as NoteScore|null,current:null as NoteScore|null};
  const piano=p.musicMode==='piano'||p.musicMode==='guided'&&
    p.referenceMidi.notes.every(n=>n.program>=0&&n.program<8);
  const ref=piano?p.referenceMidi.notes.filter(n=>n.program>=0&&n.program<8):p.referenceMidi.notes;
  if(!ref.length)return{old:null,current:null};
  const normalize=(r:MidiReference)=>r.notes.map(n=>({
   pitchMidi:n.pitchMidi,startTimeSeconds:n.startTimeSeconds,durationSeconds:n.durationSeconds,
   amplitude:.7,program:n.program,isDrum:false
  }));
  const predicted=piano?p.notes.filter(n=>n.program===undefined||n.program>=0&&n.program<8):p.notes;
  const baseline=piano?normalize(oldMidi).filter(n=>n.program>=0&&n.program<8):normalize(oldMidi);
  try{
   return{old:scoreAgainstReference(ref,baseline,p.referenceOffset),
    current:scoreAgainstReference(ref,predicted,p.referenceOffset)};
  }catch{return{old:null,current:null}}
 },[p.referenceMidi,oldMidi,p.notes,p.musicMode,p.referenceOffset]);
 const qa=validateFullSongEvidence(!!p.referenceMidi,!!oldMidi,quality.old?.f1??null,
  quality.current?.f1??null,sameRecording);
 const perfReady=perf.status==='candidate';
 const qualityReady=qa.status==='comparable';
 const manualReady=completed&&resumed&&seamsChecked;
 const ready=perfReady&&qualityReady&&manualReady;
 const readOld=async(file:File|undefined)=>{
  if(!file)return;
  setOldMidi(null);setOldError('');setSameRecording(false);
  try{setOldMidi(await readReferenceMidi(file,file.name))}
  catch(err){setOldError(err instanceof Error?err.message:'Không mở được MIDI 5L cũ.')}
 };
 const importBenchmarks=async(files:FileList|null)=>{
  if(!files?.length)return;
  if(files.length>36){setImportStatus('Tối đa 36 tệp mỗi lượt.');return}
  const reports:BenchmarkResult[]=[];
  let rejected=0;
  for(const file of Array.from(files)){
   try{
    if(!file.name.toLowerCase().endsWith('.json')||file.size<10||file.size>64000)
      throw Error('Invalid file');
    reports.push(parseSavedBenchmark(JSON.parse(await file.text())));
   }catch{rejected++}
  }
  if(reports.length)p.onImportBenchmarks(reports);
  setImportStatus('Đã nhập '+reports.length+' báo cáo hợp lệ; '+rejected+
    ' tệp bị từ chối. Chỉ dùng dữ liệu cùng PCM SHA-256 để so sánh.');
 };
 const saveReport=()=>{
  const report={
   schema:'notiq-5md-acceptance-v1',
   createdAt:new Date().toISOString(),
   model:p.model,excerptSeconds:p.clipSeconds,excerptStartSeconds:p.clipOffset,
   songDurationSeconds:p.songDuration,
   status:ready?'review-ready':'not-accepted',
   cpuAudit:perf,
   referenceMidiSupplied:!!p.referenceMidi,
   oldMidiSupplied:!!oldMidi,
   userConfirmedSameRecording:sameRecording,
   oldF1:quality.old?.f1??null,currentF1:quality.current?.f1??null,
   fullSongQuality:qa,
   manualChecks:{completed,resumed,seamsChecked},
   // No raw audio, notes, model weights, paths, or user-identifying metadata.
   caution:'User checks require independent verification; never infer Large speedup from benchmark without local runs.',
  };
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='NOTIQ-5M-D-Nghiem-thu.json';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),250);
  setExportStatus('Đã tạo tệp báo cáo nghiệm thu JSON tại máy bạn.');
 };
 return <section className="notiq-5md-panel" aria-label="5M-D nghiệm thu thực tế">
  <header><strong>5M-D · Nghiệm thu tốc độ, RAM và chất lượng MIDI</strong>
   <small>Chưa có kết quả Large trên máy thì chưa thể kết luận tăng tốc.</small>
  </header>
  <div className="notiq-5pc-review" aria-label="5P-C cổng nghiệm thu cuối">
    <strong>5P-C · Đánh giá phát hành cuối</strong>
    <p>Chỉ đánh giá kết quả Large thật từ NOTIQ-Data trên máy Windows.
      Cần hai bài dài 4–6 phút, đủ lượt 2/4/6 luồng, MIDI chuẩn cùng bản diễn
      và xác nhận nghe thử. Chưa có dữ liệu thì giữ HOLD.</p>
    <label>Nhập báo cáo đối chiếu MIDI 5P-C (.json, có checksum và TP/FP/FN)
      <input type="file" accept=".json,application/json" multiple disabled={p.busy||finalBusy}
        onChange={event=>void loadQualityFiles(event.target.files)}/>
    </label>
    <small>Đã chọn {finalQualityFiles.length} báo cáo. Đây là kết quả so sánh MIDI,
      không phải báo cáo CPU hoặc báo cáo 5M-D; hệ thống sẽ từ chối nhầm định dạng.</small>
    {([
      ['ownPlaybackReviewed','Tôi đã nghe và đối chiếu MIDI với bản ghi âm thật.'],
      ['velocityPedalReviewed','Đã nghe thử velocity và điểm đạp/nhả CC64.'],
      ['deviceResponsive','Máy Windows 16 GB vẫn phản hồi trong lúc chạy Large.'],
      ['checkpointBoundaryChecked','Đã thử tiếp tục checkpoint và kiểm tra các mốc nối 5 giây.']
    ] as const).map(([field,label])=>
      <label key={field}><input type="checkbox" checked={finalReviewFlags[field]}
        onChange={event=>{
          setFinalResult(null);
          setFinalReviewFlags(previous=>({...previous,[field]:event.target.checked}));
        }}/>{label}</label>)}
    <button type="button" disabled={p.busy||finalBusy}
      onClick={()=>void inspectFinalReview()}>
      {finalBusy?'Đang kiểm tra':'Kiểm tra 5P-C trên Windows'}
    </button>
    {finalImportError&&<p role="alert">{finalImportError}</p>}
    {finalResult&&<div role="status">
      <p><b>{finalResult.status==='HOLD'?'HOLD — CHƯA ĐƯỢC PHÁT HÀNH':
        'ĐỦ HỒ SƠ ĐỂ CHỦ SỞ HỮU XÉT DUYỆT'}</b></p>
      <small>{finalResult.independentSongs} bài · {finalResult.nativeRunsAccepted}
        lượt native đo thật · {finalResult.qualityPacketsAccepted} báo cáo MIDI hợp lệ.
        Gói Windows toàn vẹn: {finalResult.portableIntegrityPass?'Có':'Chưa xác minh'}.</small>
      {finalResult.blockers.map((reason,i)=><p key={i}>Cần bổ sung: {reason}</p>)}
      {finalResult.warnings.map((reason,i)=><small key={i}>Cần rà soát: {reason}</small>)}
      <p>Giấy phép phát hành: <b>Chưa được duyệt</b>. Ngay cả khi đủ hồ sơ,
        chủ sở hữu vẫn phải phê duyệt riêng; công cụ không tự đổi sang production.</p>
      <button type="button" onClick={saveFinalReview}>Xuất báo cáo 5P-C (JSON)</button>
    </div>}
  </div>
  <div className="notiq-5pb-review">
    <strong>5P-B · Bằng chứng nhận diện thật (Large 2,74 GB)</strong>
    <button type="button" disabled={p.busy}
      onClick={()=>void inspectRealEvidence()}>Đọc báo cáo đo thật trên máy</button>
    {realError&&<small role="alert">{realError}</small>}
    {realEvidence&&<div role="status">
      <p><b>{realEvidence.status==='HOLD'?'CHƯA ĐẠT (HOLD)':'CHỜ NGHIỆM THU THỦ CÔNG'}</b>
        {' · '} {realEvidence.sourceCount} bài · {realEvidence.validNativeRuns} lượt native hợp lệ
        {' · '} {realEvidence.loadedReports} báo cáo được tìm thấy.</p>
      {realEvidence.performance.map(entry=><div key={entry.audioSha256}>
        <small>Mã bài {entry.audioSha256.slice(0,12)}…</small>
        {entry.measurements.map((m,i)=><small key={i}>
          {' · '}{m.threads} luồng: {m.seconds}s,
          RAM native đỉnh {m.peakNativeGiB.toFixed(2)} GiB,
          {m.notes} nốt{m.resumed?', có tiếp tục checkpoint':''}
        </small>)}
      </div>)}
      {realEvidence.blockers.map((reason,index)=><p key={index}>Chưa đạt: {reason}</p>)}
      {realEvidence.warnings.map((reason,index)=><small key={index}>Cần kiểm tra: {reason}</small>)}
      <small>Chỉ đọc JSON tổng hợp trong NOTIQ-Data, không tải audio lên mạng.
        Thiếu MIDI chuẩn và đánh giá nghe thật thì hệ thống bắt buộc giữ HOLD;
        kết quả này không tự phê duyệt phát hành.</small>
    </div>}
  </div>
  <p><b>Bước 1 — Hiệu năng:</b> chạy cùng đoạn {p.clipSeconds} giây tại {p.clipOffset} giây,
   mỗi mức 2/4/6 luồng tối thiểu <b>hai lần</b> trong mục AI 5M-B. Số liệu lưu trong phiên làm việc hiện tại.</p>
  <label>Nhập báo cáo CPU 5M-B đã lưu (không cần chạy lại Large)
    <input type="file" accept=".json,application/json" multiple disabled={p.busy}
      onChange={e=>void importBenchmarks(e.target.files)}/>
  </label>
  {importStatus&&<small role="status">{importStatus}</small>}
  <p role="status">{perf.summary}</p>
  {perf.gates.length>0&&<div className="notiq-5md-scroll"><table>
   <thead><tr><th>Luồng</th><th>Lượt</th><th>Trung vị suy luận</th><th>So với 2 luồng</th><th>RAM đỉnh</th><th>Đối chiếu nốt</th><th>Đánh giá</th></tr></thead>
   <tbody>{perf.gates.map(g=><tr key={g.threads}>
    <td>{g.threads}</td><td>{g.samples}</td><td>{sec(g.inferenceMedianMs)}</td>
    <td>{g.speedup===null?'Chưa đo':g.speedup.toFixed(2)+'×'}</td>
    <td>{ram(g.peakRamBytes)}</td>
    <td>{g.outputIdentical===null?'Chưa đủ dữ liệu':g.outputIdentical?'Trùng mã băm':'Có khác biệt'}</td>
    <td>{g.status==='candidate'?'Đáng thử':g.reasons.length?g.reasons.join('; '):'Mốc gốc'}</td>
   </tr>)}</tbody>
  </table></div>}
  <p><b>Bước 2 — Chất lượng MIDI:</b> nạp MIDI chuẩn trong mục 5I, sau đó chọn MIDI đã xuất từ bản 5L trước đây của chính bài nhạc này.</p>
  <label>Nhập MIDI kết quả cũ (5L)
   <input type="file" accept=".mid,.midi" disabled={p.busy}
    onChange={e=>void readOld(e.target.files?.[0])}/>
  </label>
  {oldError&&<p role="alert">{oldError}</p>}
  {oldMidi&&<small>Đã nạp MIDI cũ: {oldMidi.notes.length} nốt, {oldMidi.tracks} track.</small>}
  <label><input type="checkbox" checked={sameRecording}
   onChange={e=>setSameRecording(e.target.checked)}/>
   Tôi xác nhận MIDI cũ, MIDI chuẩn và âm thanh đang mở thuộc cùng bản biểu diễn, đã kiểm tra thời điểm bắt đầu.</label>
  <div className="notiq-5md-metrics">
   <span>F1 bản MIDI 5L cũ: <b>{pct(quality.old?.f1??null)}</b></span>
   <span>F1 MIDI NOTIQ hiện tại: <b>{pct(quality.current?.f1??null)}</b></span>
   <span>Chênh lệch: <b>{qa.deltaF1===null?'Chưa xác định':(qa.deltaF1>=0?'+':'')+qa.deltaF1.toFixed(3)+' điểm %'}</b></span>
  </div>
  <small>{qa.explanation} F1 dựa vào pitch/onset dung sai 100ms, không thay cho nghe thật hay đánh giá pedal.</small>
  <p><b>Bước 3 — Xác nhận thủ công trên Windows</b></p>
  <label><input type="checkbox" checked={completed} onChange={e=>setCompleted(e.target.checked)}/>
   Đã xử lý và xuất MIDI hoàn chỉnh cho một bài dài, không mất nốt đã xác nhận.</label>
  <label><input type="checkbox" checked={resumed} onChange={e=>setResumed(e.target.checked)}/>
   Đã thử Dừng → mở lại cùng bài/model/luồng và thấy thông báo tiếp tục checkpoint.</label>
  <label><input type="checkbox" checked={seamsChecked} onChange={e=>setSeamsChecked(e.target.checked)}/>
   Đã nghe/đối chiếu các nốt dài và nốt lặp ở điểm nối mỗi 5 giây.</label>
  <p role="status"><b>{ready?'Đủ dữ liệu để đề nghị xem xét nghiệm thu — chưa tự duyệt production.':
    'Chưa đủ điều kiện nghiệm thu. Giữ bản chính và cấu hình mặc định.'}</b></p>
  <button type="button" onClick={saveReport}>Xuất báo cáo nghiệm thu JSON</button>
  {exportStatus&&<small role="status">{exportStatus}</small>}
  <small>Báo cáo không chứa âm thanh, MIDI nốt đầy đủ hoặc đường dẫn cá nhân. Một phép đo tốt chưa chứng minh Large nhanh hơn trên mọi bài.</small>
 </section>;
}
