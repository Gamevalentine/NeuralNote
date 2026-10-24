import type {Note} from './audio';

/** True MIDI note-on velocity lives on [1,127].  MuScriptor defaults to
 * 100/127; the model does not predict key pressure. This editor is strictly
 * manual and preserves all recognized pitches, timings, instrument and pedal.
 */
export const DEFAULT_MIDI_VELOCITY=100;
export const MIN_MIDI_VELOCITY=1;
export const MAX_MIDI_VELOCITY=127;
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));

export function midiVelocity(note:Pick<Note,'amplitude'>):number{
  const value=note.amplitude;
  if(!Number.isFinite(value))return DEFAULT_MIDI_VELOCITY;
  return clamp(Math.round(value*127),MIN_MIDI_VELOCITY,MAX_MIDI_VELOCITY);
}
export function velocityAmplitude(velocity:number):number{
  if(!Number.isFinite(velocity))throw Error('Velocity MIDI phải là số hợp lệ.');
  return clamp(Math.round(velocity),MIN_MIDI_VELOCITY,MAX_MIDI_VELOCITY)/127;
}
export function setNoteVelocity(notes:readonly Note[],index:number,velocity:number):Note[]{
  if(!Number.isInteger(index)||index<0||index>=notes.length||
     !Number.isFinite(velocity))return notes as Note[];
  const byte=clamp(Math.round(velocity),MIN_MIDI_VELOCITY,MAX_MIDI_VELOCITY);
  if(midiVelocity(notes[index])===byte)return notes as Note[];
  const result=notes.slice();
  result[index]={...result[index],amplitude:byte/127};
  return result;
}
export function nudgeNoteVelocity(notes:readonly Note[],index:number,delta:number):Note[]{
  if(!Number.isInteger(index)||index<0||index>=notes.length||
     !Number.isInteger(delta)||Math.abs(delta)>20)return notes as Note[];
  return setNoteVelocity(notes,index,midiVelocity(notes[index])+delta);
}
/** NOTE: output loudness is a SoundFont gain proxy only: cannot simulate
 * velocity-switched Kontakt samples, true acoustic piano timbre or key attack.
 * 100/127 retains previous NOTIQ playback level; no cap at 1.15, so distinct
 * velocities 116..127 no longer collapse into the same loudness.
 */
export function velocityGain(note:Pick<Note,'amplitude'>):number{
  return midiVelocity(note)/DEFAULT_MIDI_VELOCITY;
}
export function notePreviewVolume(note:Pick<Note,'amplitude'>,trackVolume:number,masterVolume:number):number{
  if(!Number.isFinite(trackVolume)||!Number.isFinite(masterVolume))return 0;
  return clamp(trackVolume,0,1)*clamp(masterVolume,0,1)*velocityGain(note);
}
