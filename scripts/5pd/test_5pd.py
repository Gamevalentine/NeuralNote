#!/usr/bin/env python3
"""Unit tests use GENERATED audio/MIDI fixtures ONLY for parser/gate logic.
They must never be reported as true acoustic piano inference or real benchmark F1.
"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import wave
import zipfile
import struct
import sys

HERE=Path(__file__).resolve().parent
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,HERE/path)
    mod=importlib.util.module_from_spec(spec)
    sys.modules[name]=mod
    spec.loader.exec_module(mod)
    return mod
core=load("benchmark_real_piano.py","notiq_5pd_core")
dataset=load("prepare_vienna.py","notiq_5pd_data")

def short_wav(path):
    with wave.open(str(path),"wb") as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
        w.writeframes(b"\0\0"*16000)

class RealBenchmarkGateTests(unittest.TestCase):
    def test_perfect_one_to_one(self):
        ref=[(60,1.,1.5,0),(64,2.,2.5,0)]
        pred=[(60,1.01,1.51,0),(64,2.01,2.49,0)]
        score=core.score_midi(ref,pred)
        self.assertEqual(score["tp"],2)
        self.assertEqual(score["fp"],0)
        self.assertEqual(score["fn"],0)
        self.assertAlmostEqual(score["f1_raw"],1.)
    def test_duplicated_note_cannot_match_two_references(self):
        ref=[(60,1.,1.5,0)]
        pred=[(60,1.01,1.51,0),(60,1.02,1.52,0)]
        score=core.score_midi(ref,pred)
        self.assertEqual((score["tp"],score["fp"],score["fn"]),(1,1,0))
        self.assertAlmostEqual(score["f1_raw"],2/3)
    def test_missing_note_and_wrong_pitch(self):
        score=core.score_midi([(60,1,1.3,0),(62,2,2.3,0)],
                              [(60,1,1.3,0),(63,2,2.3,0)])
        self.assertEqual((score["tp"],score["fp"],score["fn"]),(1,1,1))
        self.assertAlmostEqual(score["f1_raw"],.5)
    def test_onset_boundary_offset_is_not_automatically_optimized(self):
        reference=[(60,1.,1.5,0)]
        prediction=[(60,1.2,1.7,0)]
        self.assertEqual(core.score_midi(reference,prediction)["tp"],0)
        self.assertEqual(core.score_midi(reference,prediction,.2)["tp"],1)
        self.assertRaises(ValueError,core.score_midi,reference,prediction,6.)
    def test_native_json_schema_and_piano_filter(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"native.json"
            f.write_text(json.dumps({"schema":1,"engine":"muscriptor","notes":[
                {"pitchMidi":60,"startTimeSeconds":1,"durationSeconds":.5,"program":0,"isDrum":False},
                {"pitchMidi":36,"startTimeSeconds":1,"durationSeconds":.5,"program":128,"isDrum":True},
                {"pitchMidi":72,"startTimeSeconds":2,"durationSeconds":.6,"program":42,"isDrum":False}
            ]}),encoding="utf-8")
            self.assertEqual(len(core.load_native_notes(f)),1)
            f.write_text('{"schema":1,"engine":"mock","notes":[]}',encoding="utf-8")
            self.assertRaises(ValueError,core.load_native_notes,f)
    def test_wav_f32_16000_duration_rejects_bad_pcm(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"native.wav"
            head=b"RIFF"+struct.pack("<I",36+16000*4)+b"WAVE"
            head+=b"fmt "+struct.pack("<IHHIIHH",16,3,1,16000,64000,4,32)
            head+=b"data"+struct.pack("<I",16000*4)
            f.write_bytes(head+b"\0"*(16000*4))
            self.assertAlmostEqual(core.safe_riiffloat_duration(f),1.)
            f.write_bytes(head+b"\0"*100)
            self.assertRaises(ValueError,core.safe_riiffloat_duration,f)
    def test_fake_recording_is_only_short_smoke_not_full_length(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            short_wav(root/"Chopin_op10_no3_p01.wav")
            archive=root/"audio.zip"
            with zipfile.ZipFile(archive,"w") as z:
                z.write(root/"Chopin_op10_no3_p01.wav",arcname="audio/Chopin_op10_no3_p01.wav")
            self.assertRaisesRegex(ValueError,"HOLD",dataset.selected_pairs,archive)
            choices=dataset.selected_pairs(archive,allow_short=True)
            self.assertEqual(choices[0][0],"Chopin_op10_no3_p01")
            self.assertLess(choices[0][1],240)
    def test_download_creates_windows_temp_folder_before_network_request(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            destination=Path(d)/"nested"/"runner-temp"/"audio.zip"
            with patch.object(dataset.urllib.request,"urlopen",side_effect=OSError("Offline fixture")):
                with self.assertRaisesRegex(OSError,"Offline fixture"):
                    dataset.download_archive(destination)
            self.assertTrue(destination.parent.is_dir())
    def test_dataset_does_not_accept_arbitrary_zip_entry(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            short_wav(root/"unauthorized.wav")
            archive=root/"archive.zip"
            with zipfile.ZipFile(archive,"w") as z:
                z.write(root/"unauthorized.wav",arcname="../unauthorized.wav")
            self.assertRaises(ValueError,dataset.selected_pairs,archive,allow_short=True)
if __name__=="__main__":
    unittest.main()
