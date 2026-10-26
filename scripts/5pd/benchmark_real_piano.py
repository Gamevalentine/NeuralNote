#!/usr/bin/env python3
"""NOTIQ 5P-D real paired-piano benchmark. Never fabricates native inference.
Requirements: Python 3.11+, mido, psutil, trusted ffmpeg binary, MuScriptor native CLI.
Input recording + matched performance MIDI require explicit legal permission.
No audio, MIDI, paths, or original performer identifiers in the JSON report.
"""
import argparse
from bisect import bisect_left
from collections import defaultdict, deque
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time

EXPECTED_MODEL_SHA = "35a750fb1ab1e77195cdc2c0b9b4aeea2f4d59f11f729f02af9920c4854ef72e"
ONSET_TOLERANCE = .100
MAX_SECONDS = 900

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as file:
        while True:
            chunk=file.read(2**20)
            if not chunk: break
            h.update(chunk)
    return h.hexdigest()

def safe_riiffloat_duration(path):
    with open(path,"rb") as stream:
        head=stream.read(12)
        if len(head)!=12 or head[:4]!=b"RIFF" or head[8:]!=b"WAVE":
            raise ValueError("Native WAV requires RIFF/WAVE")
        fmt=None
        data=None
        while True:
            item=stream.read(8)
            if not item: break
            if len(item)!=8: raise ValueError("Truncated WAV")
            name,size=struct.unpack("<4sI",item)
            if size>MAX_SECONDS*64000+1024: raise ValueError("Oversized WAV")
            if name==b"fmt ":
                payload=stream.read(size)
                if len(payload)<16: raise ValueError("Truncated WAV fmt")
                encoding,channels,rate,_,align,bits=struct.unpack("<HHIIHH",payload[:16])
                fmt=(encoding,channels,rate,align,bits)
            elif name==b"data":
                data=size
                stream.seek(size,1)
            else:
                stream.seek(size,1)
            if size%2: stream.seek(1,1)
        if fmt!=(3,1,16000,4,32) or data is None or data<16000*4:
            raise ValueError("Expected 16 kHz mono float32 WAV")
        if path.stat().st_size<44+data: raise ValueError("Truncated PCM data")
        return data/(16000*4)

def prepare_wav(audio,output,ffmpeg,excerpt_seconds=None):
    if excerpt_seconds is not None and not 5<=excerpt_seconds<=30:
        raise ValueError("Real acoustic excerpt smoke only supports 5–30 seconds")
    command=[ffmpeg,"-nostdin","-hide_banner","-loglevel","error","-y",
             "-i",str(audio)]
    if excerpt_seconds is not None:
        command.extend(["-t",str(excerpt_seconds)])
    command.extend(["-vn","-ar","16000","-ac","1","-c:a","pcm_f32le",str(output)])
    subprocess.run(command,check=True,timeout=180)
    return safe_riiffloat_duration(output)

def read_reference_midi(path):
    import mido
    src=mido.MidiFile(str(path))
    tempo=500000
    seconds=0.
    active=defaultdict(deque)
    notes=[]
    programs=defaultdict(int)
    for message in mido.merge_tracks(src.tracks):
        seconds+=mido.tick2second(message.time,src.ticks_per_beat,tempo)
        if message.type=="set_tempo": tempo=message.tempo
        if message.is_meta or not hasattr(message,"channel"): continue
        if message.channel==9: continue
        if message.type=="program_change":programs[message.channel]=message.program
        if message.type=="note_on" and message.velocity>0:
            active[(message.channel,message.note)].append(seconds)
        elif message.type=="note_off" or (message.type=="note_on" and message.velocity==0):
            key=(message.channel,message.note)
            if active[key]:
                start=active[key].popleft()
                if seconds>start:
                    notes.append((message.note,start,seconds,programs[message.channel]))
    if not notes: raise ValueError("Reference has no paired piano note on/off events")
    return sorted(notes,key=lambda n:n[1])

def score_midi(reference,prediction,offset=0.):
    """One-to-one exact pitch + onset ±100ms, no threshold search/tuning."""
    if not math.isfinite(offset) or abs(offset)>5: raise ValueError("Offset >5s")
    by_pitch=defaultdict(list)
    for i,n in enumerate(prediction):
        by_pitch[n[0]].append((n[1],i,n))
    for arr in by_pitch.values():arr.sort()
    times={pitch:[p[0] for p in arr] for pitch,arr in by_pitch.items()}
    used=set()
    offset_errors=[]
    onset_errors=[]
    for pitch,onset,end,_ in sorted(reference,key=lambda n:n[1]):
        shifted=onset+offset
        options=by_pitch.get(pitch,[])
        j=bisect_left(times.get(pitch,[]),shifted-ONSET_TOLERANCE)
        nearest=None
        best=ONSET_TOLERANCE+1e-9
        while j<len(options) and options[j][0]<=shifted+ONSET_TOLERANCE:
            ptime,i,n=options[j]
            delta=abs(ptime-shifted)
            if i not in used and delta<best:
                best=delta;nearest=(i,n)
            j+=1
        if nearest:
            used.add(nearest[0])
            onset_errors.append(best*1000)
            offset_errors.append(abs(nearest[1][2]-(end+offset))*1000)
    tp=len(used);fp=len(prediction)-tp;fn=len(reference)-tp
    denom=2*tp+fp+fn
    return {
      "tp":tp,"fp":fp,"fn":fn,
      "precision":tp/(tp+fp) if tp+fp else 0.,
      "recall":tp/(tp+fn) if tp+fn else 0.,
      "f1_raw":(2*tp/denom) if denom else 0.,
      "onset_mae_ms":round(sum(onset_errors)/tp,3) if tp else None,
      "offset_mae_ms":round(sum(offset_errors)/tp,3) if tp else None,
      "matched_note_count":tp
    }

def load_native_notes(path):
    payload=json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schema")!=1 or payload.get("engine")!="muscriptor":
        raise ValueError("Not an actual MuScriptor native result")
    notes=[]
    for n in payload["notes"]:
        pitch=n["pitchMidi"];on=n["startTimeSeconds"];duration=n["durationSeconds"]
        prog=n.get("program",0)
        if n.get("isDrum",False) or prog not in range(8): continue
        if not (isinstance(pitch,int) and 0<=pitch<=127 and
                math.isfinite(on) and math.isfinite(duration) and
                on>=0 and duration>0 and duration<=MAX_SECONDS):
            raise ValueError("Invalid native MIDI output note")
        notes.append((pitch,on,on+duration,prog))
    return notes

def parse_native_telemetry(log_text):
    lines=log_text.splitlines()
    progress=[int(match.group(1)) for line in lines
      if (match:=re.fullmatch(r"PROGRESS\s+(\d{1,3})",line.strip()))]
    load_ms=next((int(m.group(1)) for line in lines
      if (m:=re.fullmatch(r"NOTIQ_TIMING_LOAD_WALL_MS (\\d+)",line.strip()))),None)
    update_ms=[int(m.group(1)) for line in lines
      if (m:=re.fullmatch(r"NOTIQ_TIMING_UPDATE \\d+ wall_ms=(\\d+) finalized_through_s=[0-9.]+",line.strip()))]
    return {
      "model_load_wall_ms":load_ms,
      "measured_update_count":len(update_ms),
      "slowest_update_wall_ms":max(update_ms) if update_ms else None,
      "last_real_percent":progress[-1] if progress else None,
      "highest_real_percent":max(progress) if progress else None,
      "progress_lines":len(progress),
      "checkpoint_events":sum(line.startswith("NOTIQ_CHECKPOINT ") for line in lines),
      "resumed":any(line.startswith("NOTIQ_RESUMED_NOTES ") for line in lines)
    }

class NativeRunIncomplete(RuntimeError):
    def __init__(self, reason, diagnostics):
        self.diagnostics=diagnostics
        super().__init__(reason)

def measure_inference(cli,wav,model,output,threads,timeout,checkpoint):
    import psutil
    args=[str(cli),str(wav),str(model),str(output),f"--threads={threads}","--timing"]
    if checkpoint:args.append(f"--checkpoint={checkpoint}")
    started=time.monotonic()
    # A PIPE can deadlock after many progress lines over a long recital.
    # Spool native stderr to a local temporary file; never upload it.
    native_log=open(str(output)+".stderr.txt","w+",encoding="utf-8")
    try:
        proc=subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=native_log)
    except:
        native_log.close()
        raise
    native=psutil.Process(proc.pid)
    readings=0;peak=0;cpu=0.;checkpoints=0;resumed=False
    lines=[]
    try:
        while proc.poll() is None:
            if time.monotonic()-started>timeout:
                proc.kill()
                proc.wait(timeout=10)
                native_log.flush();native_log.seek(0)
                diag=parse_native_telemetry(native_log.read())
                elapsed=time.monotonic()-started
                diag.update({
                    "elapsed_seconds":round(elapsed,2),
                    "peak_native_rss_bytes":peak if readings else None,
                    "cpu_core_equivalent":round(cpu/elapsed,3) if elapsed else None,
                    "samples":readings,
                    "termination":"TIMEOUT",
                    "midi_score_available":False
                })
                raise NativeRunIncomplete("Real MuScriptor did not finish within benchmark timeout; NO MIDI F1",diag)
            try:
                mem=native.memory_info().rss
                peak=max(peak,mem)
                cpu_times=native.cpu_times()
                cpu=cpu_times.user+cpu_times.system
                readings+=1
            except (psutil.NoSuchProcess,psutil.AccessDenied):
                pass
            time.sleep(.5)
        # Progress is from native STDERR; do not infer it from elapsed time.
        native_log.flush()
        native_log.seek(0)
        lines=native_log.read().splitlines()
        signal=parse_native_telemetry("\n".join(lines))
        checkpoints=signal["checkpoint_events"]
        resumed=signal["resumed"]
        if proc.returncode!=0 or not output.exists():
            elapsed=time.monotonic()-started
            signal.update({
              "elapsed_seconds":round(elapsed,2),
              "peak_native_rss_bytes":peak if readings else None,
              "cpu_core_equivalent":round(cpu/elapsed,3) if elapsed else None,
              "samples":readings,
              "termination":"NATIVE_FAILED",
              "midi_score_available":False
            })
            raise NativeRunIncomplete("MuScriptor returned no successful MIDI result",signal)
        elapsed=time.monotonic()-started
        if readings<2 or peak<=0:raise RuntimeError("Native memory sampling unavailable")
        return {
          "elapsed_seconds":round(elapsed,2),"peak_native_rss_bytes":peak,
          "cpu_core_equivalent":round(cpu/elapsed,3),"samples":readings,
          "checkpoint_events":checkpoints,"resumed":resumed,
          "native_progress_confirmed":signal["highest_real_percent"]==100,
          "last_real_percent":signal["last_real_percent"],
          "highest_real_percent":signal["highest_real_percent"],
          "progress_lines":signal["progress_lines"],
          "model_load_wall_ms":signal["model_load_wall_ms"],
          "slowest_update_wall_ms":signal["slowest_update_wall_ms"],
          "measured_update_count":signal["measured_update_count"]
        }
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
        native_log.close()
        try: Path(str(output)+".stderr.txt").unlink()
        except OSError: pass

def execute(args):
    audio=args.audio.resolve(strict=True)
    reference=args.reference.resolve(strict=True)
    cli=args.cli.resolve(strict=True)
    model=args.model.resolve(strict=True)
    if not args.license_id or not re.fullmatch(r"[A-Za-z0-9_.:/+-]{2,100}",args.license_id):
        raise ValueError("Dataset license identifier required")
    if args.threads not in (2,4,6):raise ValueError("Threads must be 2/4/6")
    model_hash=sha256_file(model)
    if model_hash!=EXPECTED_MODEL_SHA:
        raise ValueError("Large GGUF SHA256 mismatch — do not run unknown weights")
    ref=read_reference_midi(reference)
    with tempfile.TemporaryDirectory(prefix="notiq-5pd-") as temp:
        tmp=Path(temp)
        wav=tmp/"actual_audio_16k.wav"
        excerpt=getattr(args,"excerpt_seconds",None)
        duration=prepare_wav(audio,wav,args.ffmpeg,excerpt)
        if excerpt is not None:
            category="REAL_ACOUSTIC_EXCERPT_SMOKE_NOT_FULL_LENGTH"
            ref=[(p,o,min(end,duration),program) for p,o,end,program in ref if o<duration and end>o]
        elif duration<240 or duration>360:
            if not args.allow_short_smoke:
                raise ValueError("Real full-song acceptance requires 240–360 seconds")
            category="REAL_AUDIO_SHORT_SMOKE_ONLY"
        else:
            category="REAL_AUDIO_FULL_LENGTH"
        native_json=tmp/"native_muscriptor.json"
        checkpoint=tmp/"resume.cp" if args.checkpoint else None
        try:
            metrics=measure_inference(cli,wav,model,native_json,args.threads,args.timeout,checkpoint)
        except NativeRunIncomplete as exc:
            # Save the actual CPU/RAM/progress evidence when native inference
            # fails; NEVER emit a fabricated F1/recall or note count.
            report={
              "schema":"notiq-5pd-real-piano-v1",
              "status":"INCOMPLETE_NOT_SCORED",
              "test_kind":category,
              "license_id":args.license_id,
              "audio_sha256":sha256_file(audio),
              "native_wav_sha256":sha256_file(wav),
              "reference_midi_sha256":sha256_file(reference),
              "model_sha256":model_hash,
              "real_audio_used":True,
              "measured_audio_seconds":round(duration,2),
              "native_model":"large",
              "threads":args.threads,
              "metrics":exc.diagnostics,
              "score":None,
              "release_approved":False,
              "reason":str(exc)
            }
            target=args.report.resolve()
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
            print("NOTIQ_5PD_FAILURE_DIAGNOSTICS_SAVED_NO_SCORE",file=sys.stderr)
            raise
        candidate=load_native_notes(native_json)
        if not candidate:raise ValueError("Native output contains zero piano notes, not accepted")
        results=score_midi(ref,candidate,args.offset)
        report={
          "schema":"notiq-5pd-real-piano-v1",
          "status":"MEASURED_NOT_APPROVED",
          "test_kind":category,"license_id":args.license_id,
          "audio_sha256":sha256_file(audio),"native_wav_sha256":sha256_file(wav),
          "reference_midi_sha256":sha256_file(reference),
          "native_cli_sha256":sha256_file(cli),"model_sha256":model_hash,
          "real_recording_duration_seconds":round(duration,2),
          "native_model":"large","threads":args.threads,
          "reference_notes":len(ref),"predicted_piano_notes":len(candidate),
          "onset_tolerance_ms":100,"fixed_alignment_offset_ms":int(args.offset*1000),
          "metrics":metrics,"score":results,
          "release_approved":False,
          "limitation":"Measured on this runner, not the user's laptop; no synthesized score, no claim of pedal/velocity realism."
        }
        target=args.report.resolve()
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        print(json.dumps({"status":report["status"],"kind":category,
          "duration_seconds":report["real_recording_duration_seconds"],
          "f1_raw":results["f1_raw"],"onset_mae_ms":results["onset_mae_ms"],
          "peak_ram_gib":round(metrics["peak_native_rss_bytes"]/1024**3,2),
          "elapsed_seconds":metrics["elapsed_seconds"]}))
        return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("audio","reference","cli","model","report"):
        p.add_argument("--"+name,type=Path,required=True)
    p.add_argument("--ffmpeg",default="ffmpeg")
    p.add_argument("--license-id",required=True)
    p.add_argument("--threads",type=int,choices=[2,4,6],default=4)
    p.add_argument("--offset",type=float,default=0.,help="Predetermined MIDI alignment shift seconds; no F1 optimization")
    p.add_argument("--timeout",type=int,default=3600)
    p.add_argument("--checkpoint",action="store_true")
    p.add_argument("--excerpt-seconds",type=float,default=None,
                   help="Explicit real-audio excerpt (5–30 seconds), NOT full-song approval")
    p.add_argument("--allow-short-smoke",action="store_true")
    try: execute(p.parse_args())
    except Exception as exc:
        print("NOTIQ_5PD_REAL_INFERENCE_HOLD:",str(exc),file=sys.stderr)
        sys.exit(1)

if __name__=="__main__":
    main()
