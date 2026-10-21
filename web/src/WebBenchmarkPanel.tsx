import {useMemo} from 'react';
import type {Note} from './audio';
import {fmt} from './audio';
import type {MidiReference,MusicMode,NoteScore} from './referenceBenchmark';
import {evaluateWebMidi} from './webBenchmark';
type Props={
  mode:MusicMode;onMode:(v:MusicMode)=>void;
  reference:MidiReference|null;onReference:(file:File)=>void;
  candidate:MidiReference|null;onCandidate:(file:File)=>void;
  onClearReference:()=>void;onClearCandidate:()=>void;
  offset:number;onOffset:(v:number)=>void;
  notes:Note[];running:boolean;recognitionReady:boolean;
};
const pct=(x:number)=>((x*100).toFixed(1))+'%';
function ScoreColumn({score}:{score:NoteScore}){
 return <>
  <td>{pct(score.precision)}</td><td>{pct(score.recall)}</td>
  <td><strong>{pct(score.f1)}</strong></td>
  <td>{score.truePositive}</td><td>{score.falsePositive}</td><td>{score.falseNegative}</td>
  <td>{score.onsetMeanAbsoluteMs} ms</td><td>{score.matchedOffsetMeanAbsoluteMs} ms</td>
 </>;
}
export function WebBenchmarkPanel(props:Props){
 const {reference,candidate,notes,offset,mode}=props;
 const result=useMemo(()=>{
  if(!reference||!props.recognitionReady||notes.length===0)return null;
  try {return {data:evaluateWebMidi(notes,reference,mode,offset,candidate),error:null as string|null}}
  catch(err){return {data:null,error:err instanceof Error?err.message:'Không thể chấm MIDI chuẩn'}}
 },[notes,reference,mode,offset,candidate,props.recognitionReady]);
 return <section className="notiq-5j-panel" aria-label="NOTIQ 5J đánh giá MIDI trên web">
  <div className="notiq-5j-heading"><strong>5J · Đo MIDI trên Web</strong>
    <span>Đo trên thiết bị, không gửi âm thanh hoặc MIDI lên máy chủ</span></div>
  <div className="notiq-5j-controls">
   <label>Loại nhạc
    <select aria-label="Chế độ đánh giá Web" value={mode} disabled={props.running}
     onChange={e=>props.onMode(e.target.value as MusicMode)}>
     <option value="piano">Piano (nhóm GM 0–7)</option>
     <option value="ensemble">Đa nhạc cụ</option>
     <option value="guided">Tự chọn phạm vi dựa vào MIDI chuẩn</option>
    </select>
   </label>
   <label>Dịch MIDI chuẩn (giây)
    <input type="number" aria-label="Dịch MIDI tham chiếu Web" value={offset} step="0.01"
     min="-5" max="5" disabled={props.running}
     onChange={e=>props.onOffset(Math.max(-5,Math.min(5,Number(e.target.value)||0)))}/>
   </label>
   <label className="notiq-5j-upload">MIDI chuẩn (cùng bản diễn)
    <input type="file" aria-label="Nạp MIDI chuẩn Web" accept=".mid,.midi"
     disabled={props.running} onChange={e=>{const file=e.target.files?.[0];if(file)props.onReference(file);e.target.value=''}}/>
   </label>
   <label className="notiq-5j-upload">MIDI thứ hai (tùy chọn, từ ứng dụng khác)
    <input type="file" aria-label="Nạp MIDI ứng viên Web" accept=".mid,.midi"
     disabled={props.running} onChange={e=>{const file=e.target.files?.[0];if(file)props.onCandidate(file);e.target.value=''}}/>
   </label>
  </div>
  <div className="notiq-5j-files">
   {reference&&<span><b>Chuẩn:</b> {reference.fileName} · {reference.notes.length} nốt · {fmt(reference.durationSeconds)}
     <button type="button" onClick={props.onClearReference} disabled={props.running}>Bỏ</button></span>}
   {candidate&&<span><b>Ứng viên:</b> {candidate.fileName} · {candidate.notes.length} nốt
     <button type="button" onClick={props.onClearCandidate} disabled={props.running}>Bỏ</button></span>}
  </div>
  {!reference&&<p>Hãy tải MIDI chuẩn để chấm nốt nhận diện MuScriptor Web. Không có MIDI chuẩn thì không thể đo độ chính xác.</p>}
  {reference&&!props.recognitionReady&&<p>Đã nhận MIDI chuẩn. Hãy tải model MuScriptor Small và nhận diện âm thanh trước khi chấm.</p>}
  {reference&&props.recognitionReady&&notes.length===0&&<p>Chưa có nốt MIDI để chấm. Hãy nhận diện bài hát.</p>}
  {result?.error&&<p role="alert">{result.error}</p>}
  {result?.data&&<div aria-label="Kết quả F1 Web">
   <p>Đánh giá {result.data.referenceCount} nốt chuẩn · {result.data.scope==='piano'?'Piano GM0–7':'Đa nhạc cụ'} · cao độ chính xác và thời điểm nhấn lệch ≤100 ms.</p>
   <div className="notiq-5j-table-scroll"><table>
     <thead><tr><th>MIDI</th><th>Precision</th><th>Recall</th><th>F1</th><th>Đúng</th><th>Thừa</th><th>Thiếu</th><th>Sai lệch nhấn</th><th>Sai lệch nhả</th></tr></thead>
     <tbody>
      <tr><th>MIDI hiện tại (MuScriptor/đã chỉnh)</th><ScoreColumn score={result.data.current}/></tr>
      {result.data.imported&&<tr><th>MIDI ứng viên nhập tệp</th><ScoreColumn score={result.data.imported}/></tr>}
     </tbody>
   </table></div>
   {result.data.imported&&<p>{result.data.suggested?
     'Theo MIDI chuẩn đã tải, '+(result.data.suggested==='current'?'MIDI hiện tại':'MIDI ứng viên')+
     ' đạt F1 cao hơn ít nhất 2 điểm phần trăm. Đây không phải phân loại nhạc bằng AI.' :
     'F1 hai bản chưa khác nhau đủ 2 điểm phần trăm; chưa đề xuất một bản tốt hơn.'}</p>}
  </div>}
  <small>Model nhận diện chạy thực trên Web hiện là MuScriptor Small (209 MB). Transkun V2/ MuScriptor Large không chạy trong Cloudflare Pages tĩnh. MIDI ứng viên được tải từ máy của bạn, không phải do server tự xử lý. Điểm F1 không đánh giá velocity, phân track hoặc âm pedal. NOTIQ không tự gộp hoặc thay nốt.</small>
 </section>;
}
