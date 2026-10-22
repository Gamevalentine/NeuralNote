import type {BenchmarkResult} from './nativeBenchmark';
type Threads=2|4|6;
type Props={
 running:boolean;status:string;percent:number|null;
 seconds:20|30|60;setSeconds:(v:20|30|60)=>void;
 offset:number;setOffset:(v:number)=>void;
 duration:number;model:string;result:BenchmarkResult|null;
 trials:BenchmarkResult[];threads:Threads;setThreads:(v:Threads)=>void;
 nativeThreadsSupported:boolean;activeThreads:Threads;
 onApply:(v:Threads)=>void;
 canRun:boolean;onRun:()=>void;onCancel:()=>void;
};
const time=(n:number|null)=>n===null?'Chưa đo được':(n/1000).toFixed(2)+' giây';
const ram=(n:number|null)=>n===null?'Chưa đo được':(n/1024/1024/1024).toFixed(2)+' GiB';
export function NativeBenchmarkPanel(p:Props){
 const maxStart=Math.max(0,Math.floor(p.duration-p.seconds));
 // Only comparable exact bytes, model and clip parameters may be considered.
 const source=[...p.trials].reverse().find(x=>x.model===p.result?.model &&
  x.pcmSha256===p.result?.pcmSha256 && x.clipSeconds===p.seconds &&
  x.startSeconds===p.offset);
 const sample=source||null;
 const comparable=p.trials.filter(x=>sample&&x.model===sample.model&&
  x.clipSeconds===sample.clipSeconds&&x.startSeconds===sample.startSeconds&&
  x.pcmSha256===sample.pcmSha256);
 const latest=(threads:Threads)=>[...comparable].reverse().find(t=>t.threadCount===threads);
 const baseline=latest(2);
 const rows=([2,4,6] as Threads[]).map(threads=>{
  const r=latest(threads);
  const speedup=baseline?.inferenceMs&&r?.inferenceMs
   ?baseline.inferenceMs/r.inferenceMs:null;
  const match=baseline&&r?baseline.notesSha256===r.notesSha256:null;
  const memoryRatio=baseline?.peakWorkingSetBytes&&r?.peakWorkingSetBytes
   ?r.peakWorkingSetBytes/baseline.peakWorkingSetBytes:null;
  return {threads,result:r,speedup,memoryRatio,match};
 });
 const winner=rows.filter(x=>x.threads!==2&&x.speedup!==null&&
  x.speedup>=1.1&&x.match===true&&
  x.memoryRatio!==null&&x.memoryRatio<=1.3)
  .sort((a,b)=>(b.speedup??0)-(a.speedup??0))[0];
 return <section aria-label="5M-B đo hiệu năng AI" className="notiq-5m-panel">
  <header><strong>5M-B · So sánh số luồng MuScriptor CPU</strong>
   <small>Trên thiết bị của bạn · không sửa MIDI · không tự kích hoạt 4/6 luồng</small>
  </header>
  <div className="notiq-5m-controls">
   <label>Độ dài đoạn thử
    <select aria-label="Độ dài benchmark" disabled={p.running}
     value={p.seconds} onChange={e=>p.setSeconds(Number(e.target.value) as 20|30|60)}>
     <option value={20}>20 giây</option><option value={30}>30 giây</option><option value={60}>60 giây</option>
    </select>
   </label>
   <label>Vị trí bắt đầu (giây)
    <input aria-label="Vị trí benchmark" type="number" min={0} max={maxStart} step="1"
     disabled={p.running} value={p.offset}
     onChange={e=>p.setOffset(Math.max(0,Math.min(maxStart,Math.floor(Number(e.target.value)||0))))}/>
   </label>
   <label>Số luồng CPU cho lần đo
    <select aria-label="Số luồng CPU benchmark" value={p.threads} disabled={p.running||!p.nativeThreadsSupported}
     onChange={e=>p.setThreads(Number(e.target.value) as Threads)}>
     <option value={2}>2 luồng (mốc gốc)</option>
     <option value={4}>4 luồng</option>
     <option value={6}>6 luồng</option>
    </select>
   </label>
   <button type="button" onClick={p.onRun} disabled={!p.nativeThreadsSupported||!p.canRun||p.running||p.duration<p.seconds}>
    {p.running?'Đang đo…':'Đo '+p.threads+' luồng · '+p.seconds+' giây'}
   </button>
   {p.running&&<button type="button" onClick={p.onCancel}>Dừng benchmark</button>}
  </div>
  {!p.nativeThreadsSupported&&<p role="alert">Binary MuScriptor này chưa xác minh hỗ trợ 2/4/6 luồng. Không chạy thử hoặc báo tốc độ giả; hãy dùng bản 5M-B đầy đủ.</p>}
  <small>Chọn cùng một bài, đoạn, model {p.model}, thử 2 luồng rồi 4 và 6 từng lần một.
   Model được nạp riêng mỗi lượt, nên so sánh thời gian <b>suy luận</b>, không lấy thời gian tải model làm tốc độ AI.
   Đang áp dụng cho nhận diện bình thường: <b>{p.activeThreads} luồng</b>.</small>
  {p.running&&<p role="status">{p.status}{p.percent===null?'':' · engine báo '+p.percent+'%'}</p>}
  {p.result&&<div className="notiq-5m-results" aria-label="Kết quả benchmark CPU">
   <table><tbody>
    <tr><th>Model / đoạn thử</th><td>{p.result.modelLabel}, {p.result.clipSeconds} giây (từ {p.result.startSeconds} giây); {p.result.threadCount} luồng thực</td></tr>
    <tr><th>Chuẩn hóa âm thanh</th><td>{time(p.result.audioPrepareMs)}</td></tr>
    <tr><th>Kiểm tra SHA-256</th><td>{time(p.result.checksumMs)}</td></tr>
    <tr><th>Nạp model (CLI)</th><td>{time(p.result.loadMs)}</td></tr>
    <tr><th>Suy luận + xuất JSON</th><td>{time(p.result.inferenceMs)}</td></tr>
    <tr><th>Tổng thời gian CLI</th><td>{time(p.result.nativeTotalMs)}</td></tr>
    <tr><th>RAM đỉnh tiến trình</th><td>{ram(p.result.peakWorkingSetBytes)}</td></tr>
    <tr><th>CPU trung bình toàn máy</th><td>{p.result.machineCpuPercent===null?'Chưa đo được':p.result.machineCpuPercent+'%'}</td></tr>
    <tr><th>Số nốt</th><td>{p.result.notes}</td></tr>
    <tr><th>Lấy mẫu CPU/RAM</th><td>{p.result.cpuSamples} lần</td></tr>
   </tbody></table>
  </div>}
  {sample&&<div className="notiq-5m-results">
   <strong>So sánh đúng cùng đoạn WAV (mỗi luồng dùng lần đo gần nhất)</strong>
   <table aria-label="Bảng so sánh luồng CPU">
    <thead><tr><th>Luồng</th><th>Suy luận</th><th>Nhanh hơn 2 luồng</th><th>RAM đỉnh</th><th>Nốt có trùng khớp?</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.threads}>
     <td>{row.threads}</td>
     <td>{row.result?time(row.result.inferenceMs):'Chưa đo'}</td>
     <td>{row.speedup===null?'Chưa so được':row.speedup.toFixed(2)+'×'}</td>
     <td>{row.result?ram(row.result.peakWorkingSetBytes):'Chưa đo'}</td>
     <td>{row.match===null?'Chưa so được':row.match?'Giống hệt':'Khác nốt hoặc thời gian'}</td>
    </tr>)}</tbody>
   </table>
   {winner&&<p>Gợi ý từ số liệu đoạn này: {winner.threads} luồng suy luận nhanh hơn ít nhất 10%, RAM không tăng quá 30% và danh sách nốt giống hệt mốc 2 luồng. Chưa chứng minh nhanh hơn mọi bài.</p>}
   {!baseline&&<p>Hãy chạy mốc 2 luồng trên đúng đoạn này để có thể so sánh.</p>}
   <div className="notiq-5m-controls">
    {([2,4,6] as Threads[]).filter(n=>latest(n)).map(n=><button type="button"
     key={n} disabled={p.running||n===p.activeThreads}
     onClick={()=>p.onApply(n)}>Áp dụng {n} luồng cho nhận diện</button>)}
   </div>
  </div>}
  <small>Thay đổi thread có thể ảnh hưởng tốc độ hoặc kết quả; mã băm của nốt giống nhau không phải điểm F1.
   Benchmark lưu thời gian/CPU/RAM và hash, không lưu audio/nốt. Không tự chọn cấu hình khi chưa chạy thực tế trên máy bạn.
   Có thể dừng từng lần; không tự chạy 3 lần vì Large rất nặng.</small>
 </section>;
}
