// Header-only, weight-free ISA guard validation. No model inference.
#include "cpu_isa.hpp"
#include <iostream>
#include <string_view>
int main(int argc, char** argv) {
    if (argc!=2) return 2;
    const bool expected = std::string_view(argv[1]) == "avx2";
    if (expected != notiq_cpu_isa::kAvx2DiagnosticBuild) return 3;
    const bool available = notiq_cpu_isa::supports_avx2_fma_bmi2();
    std::cout << "NOTIQ_ISA_QUICKCHECK_PASS"
              << " diagnostic=" << (expected?"true":"false")
              << " host_supported=" << (available?"true":"false") << "\n";
    return 0;
}
