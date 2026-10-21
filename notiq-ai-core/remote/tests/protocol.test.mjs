import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API_VERSION,MAX_UPLOAD_BYTES,validateStartRequest,validateJobStatus,canTransition} from '../protocol.mjs';
const req={version:API_VERSION,engine:'transkun-v2-piano',audioBytes:1024,durationSeconds:20,mime:'audio/wav',consent:true};
test('accepted explicit consented audio job contract',()=>assert.equal(validateStartRequest(req).engine,'transkun-v2-piano'));
test('no implicit upload/remote audio without explicit consent',()=>{
 assert.throws(()=>validateStartRequest({...req,consent:false}),/consent/);
 assert.throws(()=>validateStartRequest({...req,consent:undefined}),/consent/);
});
test('enforce bounded upload duration/size and reject extraneous code or URLs',()=>{
 assert.throws(()=>validateStartRequest({...req,audioBytes:MAX_UPLOAD_BYTES+1}),/size/);
 assert.throws(()=>validateStartRequest({...req,durationSeconds:901}),/duration/);
 assert.throws(()=>validateStartRequest({...req,modelPath:'C:\\secrets'}),/Unexpected field/);
 assert.throws(()=>validateStartRequest({...req,callbackUrl:'https://bad.example'}),/Unexpected field/);
});
test('future job states cannot revive completed or cancelled jobs',()=>{
 assert.equal(canTransition('queued','running'),true);
 assert.equal(canTransition('running','cancelled'),true);
 assert.equal(canTransition('completed','running'),false);
 assert.equal(canTransition('cancelled','running'),false);
});
test('future job responses are validated, not trusted by the web UI',()=>{
 const base={version:1,jobId:'6afbe30d-3651-4b69-b722-893712049291',state:'running',stage:'infer'};
 assert.equal(validateJobStatus(base).state,'running');
 assert.throws(()=>validateJobStatus({...base,jobId:'../../secret'}),/identity/);
 assert.throws(()=>validateJobStatus({...base,state:'completed',result:{schema:1,notes:null}}),/schema/);
});
