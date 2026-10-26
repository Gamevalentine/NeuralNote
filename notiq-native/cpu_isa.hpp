#pragma once
// This file protects the optional Windows x64 *experimental* ISA build.
// Generic NOTIQ never requires AVX2. Test the host CPU and OS XSAVE state
// before entering any optimized ggml operations.
#if defined(_MSC_VER) && defined(_M_X64)
#  include <intrin.h>
#endif
namespace notiq_cpu_isa {
inline bool supports_avx2_fma_bmi2() noexcept {
#if defined(_MSC_VER) && defined(_M_X64)
    int cpu[4] = {0,0,0,0};
    __cpuid(cpu,0);
    if (cpu[0] < 7) return false;
    __cpuidex(cpu,1,0);
    constexpr int FMA = 1 << 12;
    constexpr int OSXSAVE = 1 << 27;
    constexpr int AVX = 1 << 28;
    if ((cpu[2] & (FMA|OSXSAVE|AVX)) != (FMA|OSXSAVE|AVX))
        return false;
    const unsigned __int64 xcr0 = _xgetbv(0);
    if ((xcr0 & 0x6) != 0x6) return false; // XMM + YMM enabled by OS
    __cpuidex(cpu,7,0);
    constexpr int AVX2 = 1 << 5;
    constexpr int BMI2 = 1 << 8;
    return (cpu[1] & (AVX2|BMI2)) == (AVX2|BMI2);
#else
    return false; // no permission to guess other platforms' ISA
#endif
}
#if defined(NOTIQ_EXPERIMENTAL_AVX2)
inline constexpr bool kAvx2DiagnosticBuild = true;
#else
inline constexpr bool kAvx2DiagnosticBuild = false;
#endif
} // namespace notiq_cpu_isa
