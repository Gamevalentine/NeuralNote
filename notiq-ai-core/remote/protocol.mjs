// NOTIQ 5J-B future dedicated inference server protocol (pure validation only).
// No HTTP server, paid GPU, Cloudflare Worker binding, account, or endpoint is created.
export const API_VERSION=1;
export const MAX_UPLOAD_BYTES=200*1024*1024;
export const MAX_DURATION_SECONDS=900;
export const JOB_STATES=['queued','running','completed','failed','cancelled'];
export const ENGINES=['muscriptor-large','transkun-v2-piano'];
const isPlainObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=message=>{throw new Error(message)};
export function validateStartRequest(x){
 if(!isPlainObject(x))fail('Invalid request');
 if(x.version!==API_VERSION)fail('Unsupported protocol');
 if(!ENGINES.includes(x.engine))fail('Unsupported engine');
 if(!Number.isFinite(x.audioBytes)||!Number.isInteger(x.audioBytes)||
    x.audioBytes<44||x.audioBytes>MAX_UPLOAD_BYTES)fail('Invalid audio size');
 if(!Number.isFinite(x.durationSeconds)||x.durationSeconds<=0||
    x.durationSeconds>MAX_DURATION_SECONDS)fail('Invalid audio duration');
 if(x.mime!=='audio/wav')fail('Only normalized WAV in planned contract');
 if(x.consent!==true)fail('External processing requires explicit user consent');
 // Do not accept token, URL, arbitrary command, model path or user-controlled runtime arguments.
 const allowed=['version','engine','audioBytes','durationSeconds','mime','consent'];
 if(Object.keys(x).some(k=>!allowed.includes(k)))fail('Unexpected field');
 return Object.freeze({...x});
}
export function validateJobStatus(x){
 if(!isPlainObject(x))fail('Invalid status response');
 if(x.version!==API_VERSION||typeof x.jobId!=='string'||
    !/^[a-f0-9-]{16,64}$/.test(x.jobId))fail('Invalid job identity');
 if(!JOB_STATES.includes(x.state))fail('Invalid job state');
 if(x.state==='running'&&(typeof x.stage!=='string'||x.stage.length>100))
  fail('Invalid stage');
 if(x.state==='completed'&&(!isPlainObject(x.result)||
    x.result.schema!==1||!Array.isArray(x.result.notes)||
    x.result.notes.length>150000))fail('Invalid result schema');
 return x;
}
export function canTransition(from,to){
 return ({queued:['running','cancelled','failed'],
 running:['completed','failed','cancelled'],
 completed:[],failed:[],cancelled:[]})[from]?.includes(to)===true;
}
