import type {BenchmarkResult} from './nativeBenchmark';
type Props={
 running:boolean;status:string;percent:number|null;
 seconds:20|30|60;setSeconds:(v:20|30|60)=>void;
 offset:number;setOffset:(v:number)=>void;
 duration:number;model:string;result:BenchmarkResult|null;
 canRun:boolean;onRun:()=>void;onCancel:()=>void;
};
const time=(n:number|null)=>n===null?'Chưa đo được':(n/1000).toFixed(2)+' giây';
const ram=(n:number|null)=>n===null?'Chưa đo được':(n/1024/1024/1024).toFixed(2)+' GiB';
export function NativeBenchmarkPanel(p:Props){
 const maxStart=Math.max(0,Math.floor(p.duration-p.seconds));
 return <section aria-label="5M-A đo hiệu năng AI" className="notiq-5m-panel">
  <header><strong>5M-A · Benchmark MuScriptor CPU</strong>
   <small>Đo trên máy này · không chỉnh sửa Piano Roll, không gửi âm thanh ra ngoài</small>
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
   <button type="button" onClick={p.onRun} disabled={!p.canRun||p.running||p.duration<p.seconds}>
    {p.running?'Đang đo…':'Bắt đầu đo '+p.seconds+' giây'}
   </button>
   {p.running&&<button type="button" onClick={p.onCancel}>Dừng benchmark</button>}
  </div>
  <small>Mẫu audio lấy từ bài đang mở; model {p.model}. Kiểm tra SHA và nạp model được tính riêng.
   Cấu hình AI gốc: 2 luồng CPU; giai đoạn này CHƯA thử tăng luồng.</small>
  {p.running&&<p role="status">{p.status} {p.percent===null?'':(' · engine báo '+p.percent+'%')}</p>}
  {p.result&&<div className="notiq-5m-results" aria-label="Kết quả benchmark CPU">
   <table><tbody>
    <tr><th>Model / đoạn thử</th><td>{p.result.modelLabel}, {p.result.clipSeconds} giây (từ {p.result.startSeconds} giây)</td></tr>
    <tr><th>Chuẩn hóa âm thanh (web)</th><td>{time(p.result.audioPrepareMs)}</td></tr>
    <tr><th>Kiểm tra SHA-256</th><td>{time(p.result.checksumMs)}</td></tr>
    <tr><th>Ghi WAV tạm</th><td>{time(p.result.writeMs)}</td></tr>
    <tr><th>Nạp model (CLI)</th><td>{time(p.result.loadMs)}</td></tr>
    <tr><th>Suy luận + xuất JSON (CLI)</th><td>{time(p.result.inferenceMs)}</td></tr>
    <tr><th>Tổng thời gian CLI</th><td>{time(p.result.nativeTotalMs)}</td></tr>
    <tr><th>RAM đỉnh tiến trình</th><td>{ram(p.result.peakWorkingSetBytes)}</td></tr>
    <tr><th>CPU trung bình toàn máy</th><td>{p.result.machineCpuPercent===null?'Chưa đo được':p.result.machineCpuPercent+'% ('+p.result.logicalCores+' luồng logic)'}</td></tr>
    <tr><th>Số nốt phát hiện</th><td>{p.result.notes}</td></tr>
    <tr><th>Độ phủ lấy mẫu CPU/RAM</th><td>{p.result.cpuSamples} lần</td></tr>
   </tbody></table>
   <small>Chỉ đo tiến trình MuScriptor, không phải RAM toàn Windows. Không suy đoán thời gian xử lý cả bài từ 20–60 giây.
    Số nốt chỉ để đối chiếu, không phải điểm chính xác. Kết quả JSON chỉ chứa số liệu, lưu trong {p.result.savedRelativePath} cạnh ứng dụng.</small>
  </div>}
 </section>;
}
