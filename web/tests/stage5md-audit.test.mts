import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditCpuTrials,validateFullSongEvidence} from '../src/stage5mdAudit.ts';
import type {BenchmarkResult} from '../src/nativeBenchmark.ts';
const h='a'.repeat(64),n='b'.repeat(64);
const t=(threadCount:2|4|6,inferenceMs:number,peakWorkingSetBytes:number|null=2000000000,
 notesSha256=n,pcmSha256=h):BenchmarkResult=>({
 schema:1,engine:'muscriptor',model:'large',modelLabel:'Large',clipSeconds:20,startSeconds:0,audioBytes:1280044,
 audioPrepareMs:100,checksumMs:100,writeMs:1,nativeTotalMs:inferenceMs+500,
 loadMs:500,inferenceMs,firstInferenceUpdateMs:2000,notes:100,peakWorkingSetBytes,machineCpuPercent:12,
 cpuCoreEquivalent:1,cpuSamples:6,logicalCores:8,threadCount,pcmSha256,notesSha256,
 savedRelativePath:'NOTIQ-Data/benchmarks/test.json',wallRecordedAt:'2026-10-23T12:00:00Z'
});
test('one run per thread must never be passed as enough evidence',()=>{
 const r=auditCpuTrials([t(2,100000),t(4,25000)],'large',20,0);
 assert.equal(r.status,'insufficient');assert.equal(r.gates.find(g=>g.threads===4)?.status,'pending');
});
test('two independent trials with same PCM/identical notes, <=30% extra peak RAM and >=10% speedup',()=>{
 const r=auditCpuTrials([t(2,100000),t(2,105000),t(4,60000,2200000000),t(4,62000,2200000000)],'large',20,0);
 assert.equal(r.status,'candidate');assert.equal(r.gates.find(g=>g.threads===4)?.status,'candidate');
 assert.ok((r.gates.find(g=>g.threads===4)?.speedup||0)>1.6);
});
test('different decoded WAV frames MUST NOT compare, even if same offset and name',()=>{
 const r=auditCpuTrials([t(2,100000),t(2,98000),t(4,60000,2200000000,n,'c'.repeat(64)),
 t(4,61000,2200000000,n,'c'.repeat(64))],'large',20,0);
 assert.equal(r.status,'insufficient');assert.equal(r.gates.length,0);
});
test('different note fingerprints or excessive RAM cannot be promoted',()=>{
 const values=[t(2,100000),t(2,100500),
 t(4,45000,2700000000,'c'.repeat(64)),t(4,46000,2800000000,'c'.repeat(64))];
 const g=auditCpuTrials(values,'large',20,0).gates.find(x=>x.threads===4)!;
 assert.equal(g.status,'reject');assert.equal(g.outputIdentical,false);
 assert.ok(g.reasons.some(x=>x.includes('RAM')));
});
test('missing process RAM never becomes zero and never gets certified',()=>{
 const a=auditCpuTrials([t(2,90000,null),t(2,91000,null),t(4,50000,null),t(4,49000,null)],'large',20,0);
 assert.notEqual(a.status,'candidate');
 assert.equal(a.gates.find(x=>x.threads===4)?.peakRamBytes,null);
});
test('reference MIDI and confirmed same recording required; F1 drop warning',()=>{
 assert.equal(validateFullSongEvidence(false,true,.88,.89,true).status,'missing');
 assert.equal(validateFullSongEvidence(true,true,.88,.89,false).status,'missing');
 const down=validateFullSongEvidence(true,true,.92,.88,true);
 assert.equal(down.status,'risk');assert.ok((down.deltaF1??0)<-1);
 assert.equal(validateFullSongEvidence(true,true,.9,.91,true).status,'comparable');
});
