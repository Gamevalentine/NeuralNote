import type {Comparison} from './compareEngines';
export function ComparisonOverlay({result,pitchTop,rowHeight,width,seconds}:{
 result:Comparison;pitchTop:number;rowHeight:number;width:number;seconds:number;
}){
 const items=[
  ...result.pairs.map(p=>({note:p.muscriptor,kind:'shared'})),
  ...result.muscriptorOnly.map(note=>({note,kind:'muscriptor'})),
  ...result.transkunOnly.map(note=>({note,kind:'transkun'}))
 ].slice(0,3500);
 return <>{items.map((x,index)=><div key={'5h-'+index}
  className={'notiq-5h-note '+x.kind}
  style={{
   top:(pitchTop-x.note.pitchMidi)*rowHeight+1,
   left:x.note.startTimeSeconds/seconds*100+'%',
   width:Math.max(5,x.note.durationSeconds/seconds*width)
  }}/>)}</>;
}
