#!/usr/bin/env python3
"""CC BY 4.0 Vienna 4x22 source-paired piano files, NEVER an artificial performance.
Archive source: University of Music and Performing Arts Vienna, DOI 10.21939/4X22.
MIDI performances: https://github.com/CPJKU/vienna4x22 (CC BY 4.0).
No audio or MIDI files may be committed to NOTIQ nor bundled in app releases.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import urllib.request
import wave
import zipfile

AUDIO_URL="https://datasets.mdw.ac.at/media/content_files/8dec8d0a-c4da-4a96-b290-a3ba783c03ba.zip"
EXPECTED_ARCHIVE_BYTES=1295130820  # mdwRepository's published audio.zip metadata
MIDI_RAW="https://raw.githubusercontent.com/CPJKU/vienna4x22/master/midi/"
SOURCE_CREDIT="Werner Goebl, Vienna 4x22 Piano Corpus, DOI:10.21939/4X22, CC BY 4.0"
ALLOWED_STEM=re.compile(r"^(?:Chopin|Mozart|Schubert)_[A-Za-z0-9_-]{3,80}_p\d{2}$")

def download_archive(destination):
    if destination.exists():
        if destination.stat().st_size==EXPECTED_ARCHIVE_BYTES:
            return destination
        destination.unlink()
    req=urllib.request.Request(AUDIO_URL,headers={
      "User-Agent":"NOTIQ-5PD-Corpus-QA/1.0 (non-training benchmark)"})
    temp=destination.with_suffix(".partial")
    count=0
    try:
        with urllib.request.urlopen(req,timeout=60) as response,open(temp,"wb") as out:
            if response.status!=200:raise ValueError("Download server did not return full audio.zip")
            while True:
                chunk=response.read(2**20)
                if not chunk:break
                count+=len(chunk)
                if count>EXPECTED_ARCHIVE_BYTES:raise ValueError("Unexpected archive length")
                out.write(chunk)
        if count!=EXPECTED_ARCHIVE_BYTES:
            raise ValueError(f"Archive truncated: {count} != {EXPECTED_ARCHIVE_BYTES}")
        temp.replace(destination)
    finally:
        if temp.exists():temp.unlink()
    return destination

def selected_pairs(archive, min_seconds=240, max_seconds=360, allow_short=False):
    matches=[]
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if info.is_dir() or info.file_size>300*1024*1024:continue
            if not info.filename.lower().endswith(".wav"):continue
            name=Path(info.filename).stem
            if not ALLOWED_STEM.fullmatch(name):continue
            try:
                with z.open(info) as wav:
                    with wave.open(wav,"rb") as recorded:
                        length=recorded.getnframes()/recorded.getframerate()
                        if recorded.getnchannels()<1 or recorded.getframerate()<8000:
                            continue
            except (ValueError,EOFError,wave.Error,OSError):
                continue
            matches.append((name,length,info.filename,info.file_size))
    matches.sort(key=lambda x:(-x[1],x[0]))
    if not matches:raise ValueError("No verified Vienna WAV candidates matched MIDI naming")
    suitable=[entry for entry in matches if min_seconds<=entry[1]<=max_seconds]
    chosen=suitable[:2]
    if not chosen and allow_short:
        chosen=matches[:2]
    if not chosen:raise ValueError("No unmodified 4–6 minute real performance in archive; HOLD, no splicing")
    return chosen

def prepare(outdir,archive,allow_short=False):
    outdir.mkdir(parents=True,exist_ok=True)
    chosen=selected_pairs(archive,allow_short=allow_short)
    samples=[]
    with zipfile.ZipFile(archive) as z:
        for index,(name,length,member,size) in enumerate(chosen):
            if ".." in Path(member).parts:raise ValueError("Unsafe archive path")
            file_audio=outdir/(f"real_piano_{index+1:02}.wav")
            file_midi=outdir/(f"real_piano_{index+1:02}.mid")
            with z.open(member) as inp,open(file_audio,"wb") as out:
                shutil.copyfileobj(inp,out)
            midi_url=MIDI_RAW+name+".mid"
            with urllib.request.urlopen(midi_url,timeout=45) as response:
                midi=response.read(2*1024*1024+1)
            if len(midi)>2*1024*1024 or not midi.startswith(b"MThd"):
                raise ValueError("Paired Vienna MIDI missing or not authentic SMF: "+name)
            file_midi.write_bytes(midi)
            samples.append({
              "id":f"vienna4x22-{index+1:02}",
              "audio_file":file_audio.name,"midi_file":file_midi.name,
              "source_stem":name,"real_recording_seconds":round(length,2),
              "duration_class":"FULL_4_TO_6_MIN" if 240<=length<=360 else "SHORT_REAL_SMOKE",
              "audio_sha256":hashlib.sha256(file_audio.read_bytes()).hexdigest(),
              "reference_sha256":hashlib.sha256(midi).hexdigest(),
              "license":"CC-BY-4.0","attribution":SOURCE_CREDIT,
              "source_archive":AUDIO_URL,"reference_source":midi_url,
              "notes":"True acoustic piano recording; unchanged waveform, no loops or synthesis"
            })
    (outdir/"dataset-manifest.json").write_text(
       json.dumps({"schema":"notiq-5pd-vienna-v1","samples":samples,
        "redistribution":"Do not commit or upload recordings in GitHub artifacts",
        "release_approved":False},indent=2)+"\n",encoding="utf-8")
    return samples

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outdir",type=Path,required=True)
    parser.add_argument("--archive",type=Path,default=None)
    parser.add_argument("--allow-short-smoke",action="store_true")
    args=parser.parse_args()
    archive=args.archive if args.archive else download_archive(args.outdir/"vienna-audio.zip")
    data=prepare(args.outdir,archive,args.allow_short_smoke)
    print(json.dumps({"chosen":len(data),
       "durations":[x["real_recording_seconds"] for x in data],
       "classes":[x["duration_class"] for x in data],
       "source_license":"CC-BY-4.0"}))
if __name__=="__main__":main()
