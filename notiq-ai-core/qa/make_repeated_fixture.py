#!/usr/bin/env python3
"""Create a deterministic 45-second load test by repeating an existing 15s
CC BY 4.0 MuScriptor fixture 3 times, bit-for-bit. NOT a different song.
Never add this audio file or GGUF model weights to the Git repository."""
import argparse
import struct
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("--count", type=int, default=3)
args = parser.parse_args()
if args.count < 1 or args.count > 20:
    parser.error("Count must be 1..20")
wav = args.source.read_bytes()
if wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
    raise ValueError("Expected RIFF/WAVE fixture")
pos = 12
chunk_start = None
chunk_bytes = b""
while pos + 8 <= len(wav):
    label = wav[pos:pos + 4]
    size = struct.unpack_from("<I", wav, pos + 4)[0]
    data_at = pos + 8
    if data_at + size > len(wav):
        raise ValueError("Truncated WAV chunk")
    if label == b"data":
        chunk_start = pos
        chunk_bytes = wav[data_at:data_at + size]
        break
    pos = data_at + size + (size % 2)
if chunk_start is None:
    raise ValueError("Missing PCM chunk")
if len(wav) != data_at + len(chunk_bytes):
    raise ValueError("Fixture has trailing chunks; use a separate parser")
if len(chunk_bytes) % 4:
    raise ValueError("Not float32 samples")
repeated = chunk_bytes * args.count
new_wav = bytearray(wav[:chunk_start])
new_wav.extend(b"data")
new_wav.extend(struct.pack("<I", len(repeated)))
new_wav.extend(repeated)
struct.pack_into("<I", new_wav, 4, len(new_wav) - 8)
args.destination.parent.mkdir(parents=True, exist_ok=True)
args.destination.write_bytes(new_wav)
print(f"NOTIQ_STRESS_WAV generated {len(repeated) // 4 / 16000:.1f} seconds "
      f"from real 15-second music repeated {args.count} times; {len(new_wav)} bytes")
