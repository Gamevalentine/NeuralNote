import type {BenchmarkResult,MusicMode,MidiReference} from './referenceBenchmark';
import {fmt} from './audio';
type Props={
 mode:MusicMode;onMode:(mode:MusicMode)=>void;
 reference:MidiReference|null;onFile:(file:File)=>void;onClear:()=>void;
 offset:number;onOffset:(seconds:number)=>void;
 benchmark:BenchmarkResult|null;
 running:boolean;
 canCompare:boolean;
 onEvaluate:()=>void;onCompare:()=>void;
 onUse:(engine:'muscriptor'|'transkun-v2')=>void;
};
const format=(x:number)=>Math.round(x*1000)/10+'%';
export function BenchmarkPanel({
 mode,onMode,reference,onFile,onClear,offset,onOffset,benchmark,running,canCompare,onEvaluate,onCompare,onUse
}:Props){
 return <section className="notiq-5i-panel" aria-label="NOTIQ 5I kiểm tra độ chính xác">
  <div className="notiq-5i-top">
   <strong>5I · Nhận diện theo loại nhạc & đo bằng MIDI chuẩn</strong>
   <label>Chế độ
    <select aria-label="Chế độ nhạc 5I" value={mode} disabled={running}
     onChange={e=>onMode(e.target.value as MusicMode)}>
      <option value="piano">Piano — chấm track Piano GM0–7</option>
      <option value="ensemble">Đa nhạc cụ — tất cả track giai điệu</option>
      <option value="guided">Tự đề xuất — chỉ khi có MIDI tham chiếu</option>
    </select>
   </label>
  </div>
  <p>MuScriptor xử lý đa nhạc cụ; Transkun chuyên Piano. NOTIQ không đoán loại nhạc chính xác nếu chưa có dữ liệu tham chiếu. Chế độ “Tự đề xuất” chỉ đưa ra gợi ý dựa vào điểm F1 sau khi bạn tải MIDI mẫu, không tự thay nốt.</p>
  <div className="notiq-5i-reference">
   <label className="notiq-5i-file">MIDI chuẩn (.mid/.midi, tối đa 3 MB)
    <input type="file" aria-label="Tải MIDI chuẩn 5I" accept=".mid,.midi,audio/midi"
     disabled={running} onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);e.target.value='';}}/>
   </label>
   <label>Độ dịch MIDI (giây)
    <input type="number" aria-label="Dịch thời gian MIDI" min="-5" max="5" step="0.01"
     value={offset} disabled={running} onChange={e=>onOffset(Math.max(-5,Math.min(5,Number(e.target.value)||0)))}/>
   </label>
   {reference&&<div className="notiq-5i-file-meta" title={reference.fileName}>
    <strong>{reference.fileName}</strong>
    <small>{reference.notes.length} nốt · {reference.tracks} track · {fmt(reference.durationSeconds)}</small>
    <button type="button" disabled={running} onClick={onClear}>Bỏ MIDI chuẩn</button>
   </div>}
  </div>
  <div className="notiq-5i-actions">
   <button type="button" disabled={!canCompare||running} onClick={onCompare}>Chạy hai AI để so sánh</button>
   <button type="button" disabled={!reference||!canCompare||running} onClick={onEvaluate}>
    Chấm điểm hai AI với MIDI chuẩn
   </button>
  </div>
  {!reference&&<small>Chưa có MIDI chuẩn. Bạn vẫn có thể đối chiếu độ đồng thuận như 5H, nhưng không thể tính độ chính xác thật.</small>}
  {reference&&!benchmark&&<small>Đã có MIDI chuẩn. Chạy hai AI rồi bấm Chấm điểm để đo Precision/Recall/F1. MIDI gốc phải cùng bản diễn với file âm thanh.</small>}
  {benchmark&&<div aria-label="Kết quả chấm điểm 5I">
   <table>
    <thead><tr><th>Chỉ số</th><th>MuScriptor</th><th>Transkun V2</th></tr></thead>
    <tbody>
     <tr><th>F1</th><td>{format(benchmark.muscriptor.f1)}</td><td>{format(benchmark.transkun.f1)}</td></tr>
     <tr><th>Precision</th><td>{format(benchmark.muscriptor.precision)}</td><td>{format(benchmark.transkun.precision)}</td></tr>
     <tr><th>Recall</th><td>{format(benchmark.muscriptor.recall)}</td><td>{format(benchmark.transkun.recall)}</td></tr>
     <tr><th>Nốt đúng theo ngưỡng</th><td>{benchmark.muscriptor.truePositive}</td><td>{benchmark.transkun.truePositive}</td></tr>
     <tr><th>Nốt thừa (FP)</th><td>{benchmark.muscriptor.falsePositive}</td><td>{benchmark.transkun.falsePositive}</td></tr>
     <tr><th>Nốt thiếu (FN)</th><td>{benchmark.muscriptor.falseNegative}</td><td>{benchmark.transkun.falseNegative}</td></tr>
     <tr><th>Lệch nhấn trung bình</th><td>{benchmark.muscriptor.onsetMeanAbsoluteMs} ms</td><td>{benchmark.transkun.onsetMeanAbsoluteMs} ms</td></tr>
     <tr><th>Lệch nhả trung bình</th><td>{benchmark.muscriptor.matchedOffsetMeanAbsoluteMs} ms</td><td>{benchmark.transkun.matchedOffsetMeanAbsoluteMs} ms</td></tr>
     <tr><th>Số nốt nhả trong ngưỡng</th><td>{benchmark.muscriptor.offsetWithinTolerance}</td><td>{benchmark.transkun.offsetWithinTolerance}</td></tr>
    </tbody>
   </table>
   <p className="notiq-5i-verdict">{benchmark.recommended ?
    'Theo F1 trên MIDI chuẩn đã nhập, '+(benchmark.recommended==='muscriptor'?'MuScriptor':'Transkun V2')+
     ' cao hơn ≥2 điểm phần trăm. Đây là kết quả của bản nhạc này, không phải mọi bài.' :
    'Hai AI chưa chênh ≥2 điểm phần trăm F1; chưa đủ căn cứ để đề xuất một engine.'}</p>
   {benchmark.recommended&&<button type="button" disabled={running}
      onClick={()=>onUse(benchmark.recommended!)}>Dùng kết quả AI được đề xuất (cần xác nhận)</button>}
   <small>Chỉ chấm cao độ và nhấn ±100 ms; nhả được đo riêng (±100 ms hoặc 20% độ dài). Không chấm phân loại nhạc cụ hay velocity. Dịch MIDI tham chiếu trước khi tính. Không tự gộp nốt.</small>
  </div>}
 </section>
}
