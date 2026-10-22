'use strict';
function createNativeProgressParser(onUpdate){
 let pending='',last=-1;
 return {push(chunk){
  pending+=String(chunk);
  if(pending.length>32768)pending=pending.slice(-32768);
  let end;
  while((end=pending.indexOf('\n'))>=0){
   const line=pending.slice(0,end).trim();pending=pending.slice(end+1);
   const match=/^PROGRESS\s+(\d{1,3})$/.exec(line);
   if(!match)continue;
   const pct=Number(match[1]);
   if(pct>last&&pct<=100){last=pct;onUpdate(pct)}
  }
 },get percent(){return Math.max(0,last)}};
}
module.exports={createNativeProgressParser};
