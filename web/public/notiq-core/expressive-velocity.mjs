/**
 * NOTIQ Stage 5B - OPTIONAL performance dynamics from the original audio.
 * MuScriptor (MT3) predicts pitch, program, onset/offset, not velocity/pedal.
 * This is an audio-energy heuristic, NOT model-predicted velocity.
 * Never change pitch, timing, instruments or add/delete notes.
 */
export function estimateNoteVelocities(notes, pcm, sampleRate = 16000) {
  if (!(pcm instanceof Float32Array) || sampleRate !== 16000 ||
      !Array.isArray(notes)) throw Error('Expected 16k mono Float32 audio and notes');
  const groups = new Map();
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function rms(start, count) {
    let sum=0,n=0;
    for(let k=Math.max(0,start);k<Math.min(pcm.length,start+count);k++) {
      const s=pcm[k]; if(!Number.isFinite(s)) continue;
      sum+=s*s;n++;
    }
    return n?Math.sqrt(sum/n):0;
  }
  function tonalLevel(note) {
    const onset=Math.round(note.startTimeSeconds*sampleRate);
    if(onset<0||onset>=pcm.length) return 0;
    const pitch=note.pitchMidi;
    const hz=440*Math.pow(2,(pitch-69)/12);
    const length=clamp(Math.round(Math.max(0.09,Math.min(0.16,note.durationSeconds*0.7))*sampleRate),128,2560);
    const start=clamp(onset+Math.round(0.008*sampleRate),0,Math.max(0,pcm.length-length));
    const end=Math.min(pcm.length,start+length), n=end-start;
    if(n<128||hz>=sampleRate*0.46||hz<=0) return rms(start,n);
    const spectral=(begin,f) => {
      // Hann-windowed Goertzel: only the pitch's fundamental + low partials,
      // so a simultaneous louder chord does not set every note's velocity.
      const omega=2*Math.PI*f/sampleRate,coeff=2*Math.cos(omega);
      let a=0,b=0;
      for(let i=0;i<n;i++){
        const win=0.5-0.5*Math.cos((2*Math.PI*i)/(n-1));
        const next=pcm[begin+i]*win+coeff*a-b;
        b=a;a=next;
      }
      return Math.sqrt(Math.max(0,a*a+b*b-coeff*a*b))/n;
    };
    let level=0;
    for(let harmonic=1;harmonic<=3;harmonic++) {
      if(hz*harmonic>=sampleRate*0.46)break;
      level+=spectral(start,hz*harmonic)/harmonic;
    }
    if (onset>=n) {
      let background=0;
      for(let h=1;h<=3;h++){
        if(hz*h>=sampleRate*0.46)break;
        background+=spectral(onset-n,hz*h)/h;
      }
      level=Math.max(level*0.20,level-background*0.5);
    }
    return Number.isFinite(level)?Math.max(0,level):0;
  }
  notes.forEach((note,i)=>{
    if(!note || note.isDrum || !Number.isInteger(note.pitchMidi) ||
        !Number.isFinite(note.startTimeSeconds) || !Number.isFinite(note.durationSeconds) ||
        note.durationSeconds<=0 || !Number.isInteger(note.program))return;
    const energy=tonalLevel(note);
    if(energy<=0)return;
    const program=note.program;
    if(!groups.has(program))groups.set(program,[]);
    groups.get(program).push({index:i,energy});
  });
  const result=notes.map(note=>({...note}));
  let estimated=0;
  for(const group of groups.values()){
    if(group.length<8)continue;
    const values=group.map(x=>Math.log(Math.max(1e-9,x.energy))).sort((a,b)=>a-b);
    const pick=p=>values[Math.round((values.length-1)*p)];
    const low=pick(0.12),high=pick(0.88);
    if(!Number.isFinite(high-low)||high-low<Math.log(1.3))continue;
    for(const item of group) {
      const fraction=clamp((Math.log(Math.max(1e-9,item.energy))-low)/(high-low),0,1);
      // Limit to a playable range; preserve nonzero velocity.
      // No stochastic "humanization": differences come from actual audio.
      result[item.index].amplitude=Number((0.42+0.48*fraction).toFixed(6));
      result[item.index].velocitySource='audio-energy-estimate';
      estimated++;
    }
  }
  let minAmplitude=null,maxAmplitude=null;
  for(const note of result){
    if(note.velocitySource!=='audio-energy-estimate')continue;
    minAmplitude=minAmplitude===null?note.amplitude:Math.min(minAmplitude,note.amplitude);
    maxAmplitude=maxAmplitude===null?note.amplitude:Math.max(maxAmplitude,note.amplitude);
  }
  return {notes:result,report:{
    method:'spectral-onset-energy (estimated; not native MuScriptor velocity)',
    estimated,unchanged:result.length-estimated,
    minAmplitude,maxAmplitude,
    pedalEstimated:false
  }};
}
