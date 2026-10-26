#!/usr/bin/env python3
"""A/B of native NOTIQ baseline and AVX2 on identical short CC0 piano sample.

This is an engineering speed diagnostic (Small F16), NOT proof of Large speed,
F1, full music recognition, velocity or pedal quality. Strict process deadline.
No WAV, model or MIDI exports are uploaded as artifacts.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import time
import os

SMALL_SHA="925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4"
def hash_file(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()
def parse_log(text):
    prog=[int(x) for x in re.findall(r"(?m)^PROGRESS\s+(\d{1,3})\s*$",text)]
    timing=[int(x) for x in re.findall(r"(?m)^NOTIQ_TIMING_UPDATE\s+\d+\s+wall_ms=(\d+)",text)]
    load=re.search(r"(?m)^NOTIQ_TIMING_LOAD_WALL_MS\s+(\d+)",text)
    return {"last_real_progress":prog[-1] if prog else None,
            "highest_real_progress":max(prog) if prog else None,
            "real_progress_events":len(prog),
            "real_chunks":len(timing),
            "largest_chunk_wall_ms":max(timing) if timing else None,
            "model_load_ms":int(load.group(1)) if load else None}
def load_notes(path):
    x=json.loads(path.read_text(encoding="utf-8"))
    if x.get("schema")!=1 or x.get("engine")!="muscriptor" or not isinstance(x.get("notes"),list):
        raise ValueError("Native result is not real MuScriptor MIDI")
    # Compare entire note records, not just counts; preserve natively emitted
    # real start, offset, pitch, and amplitude. No fabricated reference score.
    return x["notes"]
def run_one(exe,model,wav,work,kind,hard_seconds):
    import psutil
    output=work/(kind+".json")
    log_file=work/(kind+".stderr.txt")
    start=time.monotonic()
    with open(log_file,"w+",encoding="utf-8",errors="replace") as log:
        p=subprocess.Popen([str(exe),str(wav),str(model),str(output),
                 "--threads=4","--timing"],stdout=subprocess.DEVNULL,stderr=log)
        process=psutil.Process(p.pid)
        peak=0
        cpu=0.
        samples=0
        timed_out=False
        try:
            while p.poll() is None:
                if time.monotonic()-start>=hard_seconds:
                    timed_out=True
                    p.kill()
                    p.wait(timeout=8)
                    break
                try:
                    ram=process.memory_info().rss
                    cpu_time=process.cpu_times()
                    peak=max(peak,ram)
                    cpu=cpu_time.user+cpu_time.system
                    samples+=1
                except (psutil.NoSuchProcess,psutil.AccessDenied):
                    pass
                time.sleep(.2)
        finally:
            if p.poll() is None:
                p.kill()
                p.wait(timeout=8)
        elapsed=time.monotonic()-start
        log.flush()
        log.seek(0)
        real=parse_log(log.read())
    result={"variant":kind,"binary_sha256":hash_file(exe),
            "elapsed_wall_seconds":round(elapsed,3),
            "peak_native_rss_bytes":peak if samples else None,
            "native_cpu_core_equivalent":round(cpu/elapsed,3) if samples and elapsed else None,
            "sample_count":samples,
            "timed_out":timed_out,"exit_code":p.returncode,
            **real}
    if p.returncode==0 and output.exists() and not timed_out:
        try:
            notes=load_notes(output)
            result["completed"]=True
            result["notes_count"]=len(notes)
            result["native_notes_sha256"]=hashlib.sha256(
                json.dumps(notes,sort_keys=True,separators=(",",":")).encode()).hexdigest()
        except Exception as exc:
            result["completed"]=False
            result["validation_error_type"]=type(exc).__name__
    else:
        result["completed"]=False
    return result

def compare(baseline,optimized):
    if baseline["completed"] and optimized["completed"]:
        duration1=baseline["elapsed_wall_seconds"]
        duration2=optimized["elapsed_wall_seconds"]
        return {"kind":"FULL_NATIVE_SMOKE_COMPARISON",
                "relative_speedup":round(duration1/duration2,3) if duration2 else None,
                "equal_note_sha256":baseline["native_notes_sha256"]==optimized["native_notes_sha256"],
                "output_midi_verified":True,
                "note_difference_needs_review":baseline["native_notes_sha256"]!=optimized["native_notes_sha256"]}
    return {"kind":"INCOMPLETE_CENSORED_MEASUREMENT",
            "relative_speedup":None,
            "equal_note_sha256":None,
            "output_midi_verified":False,
            "warning":"One or both native inferences did not complete within cutoff; cannot claim speedup or accuracy."}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--baseline",type=pathlib.Path,required=True)
    p.add_argument("--optimized",type=pathlib.Path,required=True)
    p.add_argument("--model",type=pathlib.Path,required=True)
    p.add_argument("--wav",type=pathlib.Path,required=True)
    p.add_argument("--report",type=pathlib.Path,required=True)
    p.add_argument("--hard-seconds",type=int,default=60)
    a=p.parse_args()
    if not 10<=a.hard_seconds<=90:raise ValueError("Hard cutoff must be 10–90 seconds per variant")
    for file in [a.baseline,a.optimized,a.wav,a.model]:
        if not file.is_file():raise FileNotFoundError(str(file))
    model_hash=hash_file(a.model)
    if model_hash!=SMALL_SHA:raise ValueError("Only pinned SMALL GGUF is allowed in quick diagnostic")
    wav_hash=hash_file(a.wav)
    with tempfile.TemporaryDirectory(prefix="notiq-avx2-quick-") as t:
        work=pathlib.Path(t)
        base=run_one(a.baseline,a.model,a.wav,work,"baseline",a.hard_seconds)
        avx2=run_one(a.optimized,a.model,a.wav,work,"avx2",a.hard_seconds)
        outcome={
          "schema":"notiq-avx2-ab-small-quick-v1",
          "release_approved":False,
          "not_a_large_benchmark":True,
          "model":"MuScriptor Small F16 209MB",
          "model_sha256":model_hash,
          "audio_sha256":wav_hash,
          "source_license":"CC0 Meta Open Sound single isolated piano note",
          "source_type":"single recorded piano key sample, NOT musical performance",
          "hard_seconds_per_variant":a.hard_seconds,
          "runs":[base,avx2],
          "comparison":compare(base,avx2),
          "limit":"Small single piano note diagnostics cannot predict Large full-song throughput, F1 or pedal quality."
        }
        a.report.parent.mkdir(parents=True,exist_ok=True)
        a.report.write_text(json.dumps(outcome,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        print("NOTIQ_BOUNDED_AB_RESULT",json.dumps({
            "baseline_done":base["completed"],"avx2_done":avx2["completed"],
            "speedup_if_both_completed":outcome["comparison"]["relative_speedup"],
            "status":outcome["comparison"]["kind"]}))
if __name__=="__main__":
    main()
