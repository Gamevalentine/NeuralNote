export type BenchmarkResult={
 schema:1;engine:'muscriptor';model:string;modelLabel:string;
 clipSeconds:20|30|60;startSeconds:number;audioBytes:number;
 audioPrepareMs:number;checksumMs:number;writeMs:number;
 nativeTotalMs:number;loadMs:number|null;inferenceMs:number|null;
 firstInferenceUpdateMs:number|null;notes:number;
 peakWorkingSetBytes:number|null;machineCpuPercent:number|null;
 cpuCoreEquivalent:number|null;cpuSamples:number;logicalCores:number|null;
 threadCount:number;savedRelativePath:string;wallRecordedAt:string;
};
