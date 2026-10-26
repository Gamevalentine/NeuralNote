"""Zero-weight guard tests for bounded Small model A/B, not inference metrics."""
import pathlib
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import ab_smoke

class BoundedAB(unittest.TestCase):
    def test_real_progress_only(self):
        empty=ab_smoke.parse_log("logger idle; no progress")
        self.assertIsNone(empty["highest_real_progress"])
        self.assertIsNone(empty["model_load_ms"])
        self.assertEqual(empty["real_chunks"],0)
        filled=ab_smoke.parse_log("PROGRESS 3\nPROGRESS 20\nNOTIQ_TIMING_LOAD_WALL_MS 560\n"
                                  "NOTIQ_TIMING_UPDATE 1 wall_ms=202 finalized_through_s=5.00\n")
        self.assertEqual(filled["highest_real_progress"],20)
        self.assertEqual(filled["model_load_ms"],560)
        self.assertEqual(filled["largest_chunk_wall_ms"],202)
    def test_one_timeout_cannot_claim_speedup(self):
        a={"completed":True,"elapsed_wall_seconds":20,"native_notes_sha256":"abc"}
        b={"completed":False,"elapsed_wall_seconds":60}
        result=ab_smoke.compare(a,b)
        self.assertEqual(result["kind"],"INCOMPLETE_CENSORED_MEASUREMENT")
        self.assertIsNone(result["relative_speedup"])
        self.assertFalse(result["output_midi_verified"])
    def test_complete_pair_requires_identical_note_hash_for_exact_match(self):
        a={"completed":True,"elapsed_wall_seconds":30,"native_notes_sha256":"abc"}
        b={"completed":True,"elapsed_wall_seconds":15,"native_notes_sha256":"def"}
        c=ab_smoke.compare(a,b)
        self.assertEqual(c["relative_speedup"],2)
        self.assertFalse(c["equal_note_sha256"])
        self.assertTrue(c["note_difference_needs_review"])
    def test_small_model_hash_pinned_and_release_never_approved(self):
        source=pathlib.Path(ab_smoke.__file__).read_text(encoding="utf-8")
        self.assertIn("925f55af65a20ebc4f8b45ceaf095a12b72493d436cb112623cd0041a1af23d4",source)
        self.assertIn('"release_approved":False',source)
        self.assertIn('not_a_large_benchmark',source)
        self.assertIn('10<=a.hard_seconds<=90',source)
    def test_no_user_data_or_audio_artifacts_in_workflow(self):
        source=pathlib.Path(__file__).resolve().parents[2]
        wf=(source/".github/workflows/notiq-native-avx2-ab.yml").read_text(encoding="utf-8")
        self.assertIn("compression-level: 9",wf)
        self.assertNotIn("upload-artifact",wf.split("name: Publish compact diagnostics only")[0])
        self.assertIn("hard-seconds 60",wf)
if __name__=="__main__":
    unittest.main()
