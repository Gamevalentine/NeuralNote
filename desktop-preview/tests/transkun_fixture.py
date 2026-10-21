#!/usr/bin/env python3
"""Synthetic 2-second piano-like audio used ONLY for real Transkun load/inference smoke QA."""
import json
import math
import struct
import sys
from pathlib import Path
def main():
    output=Path(sys.argv[1])
    rate=16000
    seconds=2
    samples=rate*seconds
    data=bytearray(samples*4)
    for i in range(samples):
        t=i/rate
        # Real wave construction: three piano-like harmonics with finite decay,
        # not a claim of true rendered piano or ground-truth model precision.
        envelope=math.exp(-t*1.1)*min(1.,t*200)
        val=envelope*sum(math.sin(2*math.pi*440*k*t)*[.23,.09,.04][k-1] for k in range(1,4))
        struct.pack_into('<f',data,4*i,val)
    header=bytearray(44)
    struct.pack_into('<4sI4s4sIHHIIHH4sI',header,0,b'RIFF',36+len(data),b'WAVE',b'fmt ',
      16,3,1,rate,rate*4,4,32,b'data',len(data))
    output.write_bytes(header+data)
if __name__=='__main__':main()
