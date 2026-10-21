#!/usr/bin/env python3
"""Stage 5G isolated MIT-licensed Transkun V2 piano runner (not MuScriptor).
Runs only after user opts in to installing its Python/PyTorch environment.
Accepts only NOTIQ's mono/16kHz/f32 WAV format. Output is a separate engine schema.
"""
import argparse
import importlib.resources
import json
import struct
import sys
from pathlib import Path

def parse_pcm32_float_wav(filename):
    import numpy as np
    b=Path(filename).read_bytes()
    if (len(b)<44 or b[0:4]!=b'RIFF' or b[8:12]!=b'WAVE'
            or b[12:16]!=b'fmt ' or b[36:40]!=b'data'):
        raise ValueError('Expected NOTIQ mono float32 WAV header')
    fmt,channels,rate=struct.unpack_from('<HHI',b,20)
    data_len=struct.unpack_from('<I',b,40)[0]
    if fmt!=3 or channels!=1 or rate!=16000 or data_len>len(b)-44 or data_len%4:
        raise ValueError('Expected mono IEEE float32 16000 Hz with correct data length')
    if data_len>15*60*16000*4:
        raise ValueError('Max 15 minutes supported')
    return np.frombuffer(b,dtype='<f4',count=data_len//4,offset=44).copy().reshape(-1,1)

def run(audio,out,limit_seconds=None):
    import moduleconf
    import soxr
    import torch
    import transkun
    from transkun.Data import writeMidi
    root=importlib.resources.files('transkun')
    checkpoint=root.joinpath('pretrained/2.0.pt')
    config=root.joinpath('pretrained/2.0.conf')
    if not checkpoint.is_file() or not config.is_file():
        raise RuntimeError('Official Transkun V2 checkpoint not installed')
    config_manager=moduleconf.parseFromFile(str(config))
    model_class=config_manager['Model'].module.TransKun
    config_data=config_manager['Model'].config
    print('PROGRESS loading official Transkun V2 checkpoint',flush=True)
    # Checkpoint shipped by the trusted, pinned upstream PyPI package; unlike
    # arbitrary user-supplied pickle, no custom weight input is accepted.
    state=torch.load(str(checkpoint),map_location='cpu',weights_only=False)
    model=model_class(conf=config_data).to('cpu')
    model.load_state_dict(state.get('best_state_dict',state.get('state_dict')),strict=False)
    model.eval()
    audio_np=parse_pcm32_float_wav(audio)
    if limit_seconds is not None:
        audio_np=audio_np[:int(float(limit_seconds)*16000)]
    if model.fs!=16000:
        audio_np=soxr.resample(audio_np,16000,model.fs)
    print('PROGRESS transcribing piano using CPU; long songs may take a while',flush=True)
    with torch.inference_mode():
        notes=model.transcribe(torch.from_numpy(audio_np.copy()).to('cpu'),
            stepInSecond=None,segmentSizeInSecond=None,discardSecondHalf=False)
    midi=writeMidi(notes)
    events=[]
    for instrument in midi.instruments:
        if instrument.is_drum:continue
        for note in instrument.notes:
            start,end=float(note.start),float(note.end)
            if not(0<=start<end<=15*60+10) or not(0<=int(note.pitch)<=127):continue
            events.append({'pitchMidi':int(note.pitch),'startTimeSeconds':start,
                'durationSeconds':end-start,'amplitude':min(1.,max(0.,int(note.velocity)/127.)),
                'program':0,'isDrum':False})
    pedals=[]
    for instrument in midi.instruments:
        if instrument.is_drum:continue
        for cc in instrument.control_changes:
            if cc.number==64 and cc.value>=0 and cc.time>=0:
                pedals.append({'trackKey':'gm-0','timeSeconds':float(cc.time),
                    'value':127 if cc.value>=64 else 0})
    events.sort(key=lambda n:(n['startTimeSeconds'],n['pitchMidi']))
    pedals.sort(key=lambda p:p['timeSeconds'])
    payload={'schema':1,'engine':'transkun-v2','notes':events,'pedalEvents':pedals}
    Path(out).write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
    print('PROGRESS completed; '+str(len(events))+' piano notes',flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--self-test',action='store_true')
    parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--limit-seconds',type=float,default=None)
    args=parser.parse_args()
    if args.self_test:
        import torch,transkun,moduleconf,soxr,pretty_midi
        root=importlib.resources.files('transkun')
        if not root.joinpath('pretrained/2.0.pt').is_file():raise RuntimeError('Missing V2 checkpoint')
        print('NOTIQ_TRANSKUN_V2_READY torch='+torch.__version__,flush=True)
        return
    if not args.input or not args.output:parser.error('--input and --output required')
    run(args.input,args.output,args.limit_seconds)

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('TRANSKUN_ERROR '+str(exc),file=sys.stderr,flush=True)
        raise
