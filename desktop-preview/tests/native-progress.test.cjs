'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createNativeProgressParser}=require('../native-progress.cjs');
test('actual complete lines only, including split chunks',()=>{
 const out=[],p=createNativeProgressParser(n=>out.push(n));
 p.push('PRO');assert.deepEqual(out,[]);
 p.push('GRESS 3\nPROGRESS 20\r\n');
 p.push('PROGRESS 54\nPROGRESS 54\nPROGRESS 51\n');
 p.push('PROGRESS 100\n');
 assert.deepEqual(out,[3,20,54,100]);
});
test('reject incomplete, malformed and fabricated percentages',()=>{
 const out=[],p=createNativeProgressParser(n=>out.push(n));
 p.push('PROGRESS 10');assert.deepEqual(out,[]);
 p.push('0\nnoise PROGRESS 99\nPROGRESS 201\nPROGRESS -1\n');
 assert.deepEqual(out,[100]);
});
test('real native 98% stays unfinished until confirmed exit',()=>{
 const out=[],p=createNativeProgressParser(n=>out.push(n));
 p.push('PROGRESS 3\nPROGRESS 20\nPROGRESS 98\n');
 assert.equal(p.percent,98);assert.deepEqual(out,[3,20,98]);
});
