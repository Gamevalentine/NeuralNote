'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inspectPortable,sha256,isX64PE,ASAR_MODULES}=require('../release-audit.cjs');
const mockPE=()=>{const b=Buffer.alloc(512);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);b.writeUInt16LE(0x8664,0x84);return b};
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'notiq-5p-qa-'));
 const put=(rel,b)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);return p};
 put('NOTIQ-Stage5-FullSong.exe',mockPE());
 put('resources/bridge-bin/notiq-muscriptor-cli.exe',mockPE());
 put('resources/app.asar','asar-placeholder');
 return{root,put,dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const parser={extractFile:(_archive,name)=>{
 if(name==='www/index.html')return Buffer.from('<script src="./assets/index.js"></script>');
 return Buffer.from('present');}};
test('5P source portable audit validates all required modules but NEVER approves production',()=>{
 const d=setup();try{
  const x=inspectPortable(d.root,{asar:parser});
  assert.equal(x.releaseApproved,false);assert.equal(x.status,'QA_PREVIEW_ONLY');
  assert.equal(x.requiredAsarFiles.length,ASAR_MODULES.length);
  assert.equal(x.files.app.sha256,sha256(path.join(d.root,'NOTIQ-Stage5-FullSong.exe')));
  assert.equal(x.modelWeightsIncluded,false);
 }finally{d.dispose();}
});
test('5P fails closed if app/CLI is not genuine Windows x64 PE',()=>{
 const d=setup();try{
  assert.equal(isX64PE(path.join(d.root,'NOTIQ-Stage5-FullSong.exe')),true);
  d.put('resources/bridge-bin/notiq-muscriptor-cli.exe',Buffer.from('NOT_AN_EXE'));
  assert.throws(()=>inspectPortable(d.root,{asar:parser}),/x64/);
 }finally{d.dispose();}
});
test('5P fails if ASAR runtime adapter missing, even when desktop EXEs are present',()=>{
 const d=setup();try{
  assert.throws(()=>inspectPortable(d.root,{asar:{extractFile:(_p,file)=>{
    if(file==='full-song-health.cjs')throw Error('Missing');
    return parser.extractFile(_p,file);}}}),/full-song-health/);
 }finally{d.dispose();}
});
test('5P fails if model weights are accidentally included in portable preview',()=>{
 const d=setup();try{
  d.put('models/muscriptor-large.gguf','not allowed');
  assert.throws(()=>inspectPortable(d.root,{asar:parser}),/Model weights/);
 }finally{d.dispose();}
});
test('5P rejects missing Web renderer or corrupted required files',()=>{
 const d=setup();try{
  assert.throws(()=>inspectPortable(d.root,{asar:{extractFile:()=>Buffer.alloc(0)}}),/empty/);
  assert.throws(()=>inspectPortable(d.root,{asar:{extractFile:()=>{throw Error('broken')}}}),/missing/);
 }finally{d.dispose();}
});
