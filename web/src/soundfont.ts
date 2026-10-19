import { WorkletSynthesizer } from 'spessasynth_lib';
import type { PitchGroup } from './audio';

export const GM_PRESETS = [
  { number: 0, name: 'Piano cơ' }, { number: 2, name: 'Piano điện' },
  { number: 8, name: 'Celesta' }, { number: 16, name: 'Organ' },
  { number: 24, name: 'Guitar mộc' }, { number: 26, name: 'Guitar điện' },
  { number: 29, name: 'Guitar distortion' }, { number: 32, name: 'Bass mộc' },
  { number: 33, name: 'Bass điện' }, { number: 40, name: 'Violin' },
  { number: 41, name: 'Viola' }, { number: 42, name: 'Cello' },
  { number: 48, name: 'Dàn dây' }, { number: 50, name: 'Synth Strings' },
  { number: 52, name: 'Giọng hợp xướng' }, { number: 56, name: 'Trumpet' },
  { number: 57, name: 'Trombone' }, { number: 60, name: 'Kèn horn' },
  { number: 64, name: 'Saxophone' }, { number: 66, name: 'Sax tenor' },
  { number: 72, name: 'Sáo' }, { number: 80, name: 'Synth Lead' },
  { number: 88, name: 'Synth Pad' }, { number: 100, name: 'Hiệu ứng' },
] as const;
export type Programs = Record<PitchGroup, number>;
const channels: Record<PitchGroup, number> = { high: 0, mid: 1, low: 2 };

export class NeuralNoteSoundFont {
  private context: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private loading: Promise<void> | null = null;
  private noteTimers = new Set<number>();

  async prepare(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.initialize().catch((error: unknown) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }
  private async initialize(): Promise<void> {
    const ctx = new AudioContext();
    this.context = ctx;
    try {
      await ctx.resume();
      const response = await fetch('/soundfonts/NeuralNote_GM.sf3');
      if (!response.ok) throw new Error('Không tải được bộ tiếng NeuralNote GM (HTTP ' + response.status + ').');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 1_000_000) throw new Error('Bộ tiếng NeuralNote GM chưa được tạo khi build Cloudflare.');
      await ctx.audioWorklet.addModule('/spessasynth_processor.min.js');
      const synth = new WorkletSynthesizer(ctx);
      this.synth = synth;
      synth.connect(ctx.destination);
      await synth.soundBankManager.addSoundBank(buffer, 'NeuralNote_GM');
      await synth.isReady;
      for (const channel of Object.values(channels)) synth.programChange(channel, 0);
    } catch (error) {
      if (this.synth) this.synth.destroy();
      this.synth = null;
      await ctx.close().catch(() => undefined);
      this.context = null;
      throw error;
    }
  }
  async play(pitch: number, duration: number, group: PitchGroup, program: number, volume: number): Promise<void> {
    await this.prepare();
    if (!this.context || !this.synth) throw new Error('Bộ tiếng nhạc cụ chưa sẵn sàng.');
    if (this.context.state !== 'running') await this.context.resume();
    const channel = channels[group];
    this.synth.programChange(channel, program);
    this.synth.controllerChange(channel, 7, Math.max(0, Math.min(127, Math.round(volume * 127))));
    const midiPitch = Math.round(pitch);
    this.synth.noteOn(channel, midiPitch, 112);
    const timer = window.setTimeout(() => {
      this.noteTimers.delete(timer);
      this.synth?.noteOff(channel, midiPitch);
    }, Math.min(8000, Math.max(75, duration * 1000)));
    this.noteTimers.add(timer);
  }
  stop(): void {
    for (const timer of this.noteTimers) window.clearTimeout(timer);
    this.noteTimers.clear();
    this.synth?.stopAll(true);
  }
  dispose(): void {
    this.stop();
    this.synth?.destroy();
    this.synth = null;
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.loading = null;
  }
}
