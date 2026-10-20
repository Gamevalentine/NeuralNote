import Soundfont from 'soundfont-player';
import type { PitchGroup } from './audio';

export const INSTRUMENTS = [
  { id: 'acoustic_grand_piano', label: 'Piano', program: 0 },
  { id: 'acoustic_guitar_nylon', label: 'Guitar mộc', program: 24 },
  { id: 'electric_bass_finger', label: 'Bass điện', program: 33 },
  { id: 'violin', label: 'Violin', program: 40 },
  { id: 'flute', label: 'Sáo Flute', program: 73 },
  { id: 'marimba', label: 'Marimba', program: 12 },
] as const;

export type InstrumentId = (typeof INSTRUMENTS)[number]['id'];
export type InstrumentSelection = Record<PitchGroup, InstrumentId>;

export const DEFAULT_INSTRUMENTS: InstrumentSelection = {
  high: 'acoustic_grand_piano',
  mid: 'acoustic_guitar_nylon',
  low: 'electric_bass_finger',
};

export const instrumentProgram = (id: InstrumentId): number =>
  INSTRUMENTS.find(preset => preset.id === id)?.program ?? 0;

// FluidR3_GM MP3 sample banks are loaded only when the instrument is used.
// Soundfont-player library: MIT; FluidR3_GM renderings: CC BY 3.0 (attribution
// displayed in app and NOTICE). Never silently replace a failed load with an oscillator.
const SOURCE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
const soundfontUrl = (id: string) => SOURCE + id + '-mp3.js';

type Player = Awaited<ReturnType<typeof Soundfont.instrument>>;
const cache = new WeakMap<AudioContext, Map<InstrumentId, Promise<Player>>>();

export function prepareInstrument(ctx: AudioContext, instrument: InstrumentId): Promise<Player> {
  let instruments = cache.get(ctx);
  if (!instruments) {
    instruments = new Map();
    cache.set(ctx, instruments);
  }
  const existing = instruments.get(instrument);
  if (existing) return existing;

  const promise = Soundfont.instrument(ctx, instrument, {
    soundfont: 'FluidR3_GM',
    format: 'mp3',
    nameToUrl: soundfontUrl,
  }).catch((error: unknown) => {
    instruments?.delete(instrument); // retry is possible after a CDN/network failure
    throw error;
  });
  instruments.set(instrument, promise);
  return promise;
}

export async function playSoundfontNote(
  ctx: AudioContext, instrument: InstrumentId, pitch: number, duration: number, volume: number,
): Promise<void> {
  if (ctx.state !== 'running') await ctx.resume();
  const player = await prepareInstrument(ctx, instrument);
  player.play(Math.max(0, Math.min(127, Math.round(pitch))), ctx.currentTime,
    { duration: Math.max(0.07, Math.min(8, duration)),
      gain: Math.max(0.001, Math.min(1, volume)) });
}
