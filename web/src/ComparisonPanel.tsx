import type {Comparison} from './compareEngines';
import {fmt,noteName} from './audio';
type Props={
 result:Comparison;
 onUse:(engine:'muscriptor'|'transkun-v2'|'original')=>void;
 onSeek:(timeSeconds:number)=>void;
 onClose:()=>void;
 disabled:boolean;
 canRestore:boolean;
};
export function ComparisonPanel({result,onUse,onSeek,onClose,disabled,canRestore}:Props){
 const differences=[
  ...result.muscriptorOnly.slice(0,30).map(n=>({note:n,source:'MuScriptor'})),
  ...result.transkunOnly.slice(0,30).map(n=>({note:n,source:'Transkun V2'}))
 ].sort((a,b)=>a.note.startTimeSeconds-b.note.startTimeSeconds).slice(0,24);
 return <section className="notiq-5h-panel" aria-label="Bảng đối chiếu hai AI" role="region">
  <div className="notiq-5h-head"><strong>5H · Đối chiếu MuScriptor / Transkun V2 Piano</strong>
   <button type="button" onClick={onClose} aria-label="Đóng bảng 5H">×</button>
  </div>
  <div className="notiq-5h-stats">
    <div><strong>{result.pairs.length}</strong><small>Trùng cao độ và lệch đầu ≤100 ms</small></div>
    <div><strong>{result.muscriptorOnly.length}</strong><small>Chỉ MuScriptor</small></div>
    <div><strong>{result.transkunOnly.length}</strong><small>Chỉ Transkun V2</small></div>
    <div><strong>{result.meanAbsOnsetDifferenceMs} ms</strong><small>Lệch thời điểm trung bình (nốt ghép)</small></div>
    <div><strong>{result.meanAbsDurationDifferenceMs} ms</strong><small>Lệch độ dài trung bình</small></div>
  </div>
  <p className="notiq-5h-caution"><strong>Đây là độ đồng thuận, không phải độ chính xác.</strong> Nốt riêng một AI chưa chắc sai. MuScriptor nhận nhiều nhạc cụ; cần MIDI đáp án để xác định nốt nào đúng.</p>
  <div className="notiq-5h-legend">
   <span><b className="shared"/> Nốt trùng</span>
   <span><b className="muscriptor"/> Chỉ MuScriptor</span>
   <span><b className="transkun"/> Chỉ Transkun</span>
  </div>
  <div className="notiq-5h-actions">
   <button type="button" disabled={disabled} onClick={()=>onUse('muscriptor')}>Dùng MuScriptor ({result.muscriptor.notes.length} nốt)</button>
   <button type="button" disabled={disabled} onClick={()=>onUse('transkun-v2')}>Dùng Transkun ({result.transkun.notes.length} nốt)</button>
   <button type="button" disabled={disabled||!canRestore} onClick={()=>onUse('original')}>Khôi phục MIDI trước khi so sánh</button>
  </div>
  <div className="notiq-5h-disagreements" aria-label="Danh sách nốt bất đồng">
   <strong>Vị trí cần nghe lại</strong>
   <div>{differences.map((entry,index)=>
    <button type="button" key={index} onClick={()=>onSeek(entry.note.startTimeSeconds)}
     title="Nhấn để chuyển đầu phát tới vị trí nốt">
      {fmt(entry.note.startTimeSeconds)} · {noteName(entry.note.pitchMidi)} · {entry.source}
    </button>)}
    {!differences.length&&<small>Không có nốt khác biệt ở ngưỡng 100 ms.</small>}
   </div>
  </div>
  <small className="notiq-5h-footer">Piano Roll vẫn giữ nốt đang chỉnh cho đến khi bạn chủ động chọn một kết quả. Các vạch màu là lớp đối chiếu, không phải MIDI đã gộp. Chỉ hiển thị tối đa 3.500 vạch để giữ giao diện mượt.</small>
 </section>;
}
