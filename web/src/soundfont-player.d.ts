declare module 'soundfont-player' {
  interface Playback { stop(when?: number): void }
  export interface Instrument {
    play(note: number | string, when?: number, options?: {
      duration?: number; gain?: number; attack?: number; release?: number;
    }): Playback;
    stop(): void;
  }
  interface InstrumentOptions {
    soundfont?: 'FluidR3_GM' | 'MusyngKite';
    format?: 'mp3' | 'ogg';
    nameToUrl?: (name: string, soundfont?: string, format?: string) => string;
  }
  const Soundfont: {
    instrument(ctx: AudioContext, name: string, options?: InstrumentOptions): Promise<Instrument>;
  };
  export default Soundfont;
}
