#!/usr/bin/env python3
"""Cheap, no-weights source policy checks. NOT a throughput benchmark."""
import pathlib
import subprocess
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
def source(path):return (ROOT/path).read_text(encoding="utf-8")

class Avx2Isolation(unittest.TestCase):
    def test_vendor_revision_identical_to_pinned_git_submodule(self):
        pinned=source("notiq-ai-core/vendor/muscriptor/SOURCE_REVISION").strip()
        line=subprocess.check_output(["git","ls-tree","HEAD","ThirdParty/muscriptor.cpp"],
                                     cwd=ROOT,text=True).strip()
        self.assertEqual(line.split()[2],pinned)

    def test_baseline_release_uses_original_submodule(self):
        cmake=source("notiq-native/CMakeLists.txt")
        self.assertIn('option(NOTIQ_ENABLE_AVX2_DIAGNOSTIC',cmake)
        self.assertIn('INTERNAL WINDOWS QA ONLY: build AVX2/BMI2/FMA MuScriptor" OFF',cmake)
        self.assertIn('ThirdParty/muscriptor.cpp/cpp',cmake)
        self.assertIn('notiq-ai-core/vendor/muscriptor/cpp',cmake)
        self.assertIn('if(NOTIQ_ENABLE_AVX2_DIAGNOSTIC)',cmake)
        self.assertIn('if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)',cmake)

    def test_vendor_only_optin_ggml_features(self):
        cmake=source("notiq-ai-core/vendor/muscriptor/cpp/CMakeLists.txt")
        self.assertIn('option(NOTIQ_EXPERIMENTAL_AVX2',cmake)
        self.assertIn('GGML_AVX2 GGML_BMI2 GGML_FMA',cmake)
        self.assertIn('set($'+'{MUSCRIPTOR_X86_FEATURE} $'+'{NOTIQ_EXPERIMENTAL_AVX2}',cmake)
        self.assertIn('if(TARGET ggml-cpu AND NOT NOTIQ_EXPERIMENTAL_AVX2)',cmake)

    def test_experimental_build_gated_before_model(self):
        cli=source("notiq-native/main.cpp")
        self.assertIn('notiq_cpu_isa::supports_avx2_fma_bmi2()',cli)
        self.assertLess(cli.index('if(notiq_cpu_isa::kAvx2DiagnosticBuild'),
                        cli.index('auto engine=msl::Transcriber::load'))
        hdr=source("notiq-native/cpu_isa.hpp")
        for x in ('_xgetbv','FMA','OSXSAVE','AVX2','BMI2','0x6'):
            self.assertIn(x,hdr)

    def test_large_inference_cannot_run_from_auto_push(self):
        flow=source(".github/workflows/notiq-stage5pd-real-piano.yml")
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.enable_large_diagnostic == true",flow)
        self.assertNotIn("contains(github.event.head_commit.message",flow)
if __name__=="__main__":
    unittest.main()
