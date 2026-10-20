// One centralized limit for the browser and the Windows native bridge.
// 15 minutes covers full-length songs, not just audio excerpts. Longer files
// require a separate low-memory streaming implementation.
export const MAX_SONG_SECONDS = 15 * 60;
export const MAX_SONG_BYTES = 200 * 1024 * 1024;
export const CHUNK_CORE_SECONDS = 25;
export const CHUNK_CONTEXT_SECONDS = 2;

export type SongChunk = {
  index: number;
  coreStart: number;
  coreEnd: number;
  renderStart: number;
  renderEnd: number;
};

export type TimedNote = {
  pitchMidi: number;
  startTimeSeconds: number;
  durationSeconds: number;
};

export function assertSupportedSong(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('Tệp âm thanh không có thời lượng hợp lệ.');
  if (duration > MAX_SONG_SECONDS)
    throw new Error('Bài hát dài hơn 15 phút. Bản hiện tại hỗ trợ cả bài dài tối đa 15 phút.');
}

export function planSongChunks(duration: number): SongChunk[] {
  assertSupportedSong(duration);
  const count = Math.ceil(duration / CHUNK_CORE_SECONDS);
  return Array.from({length: count}, (_, index) => {
    const coreStart = index * CHUNK_CORE_SECONDS;
    const coreEnd = Math.min(duration, (index + 1) * CHUNK_CORE_SECONDS);
    return {
      index,
      coreStart,
      coreEnd,
      renderStart: Math.max(0, coreStart - CHUNK_CONTEXT_SECONDS),
      renderEnd: Math.min(duration, coreEnd + CHUNK_CONTEXT_SECONDS),
    };
  });
}

/** Only the chunk owning a note's onset emits it. Neighbouring chunks overlap
 * for context; without the ownership rule notes at each boundary get duplicated.
 * The slight onset hysteresis is handled by mergeChunkNotes below. */
export function collectChunkNotes<T extends TimedNote>(chunk: SongChunk, notes: T[]): T[] {
  return notes
    .map(note => ({...note, startTimeSeconds: note.startTimeSeconds + chunk.renderStart}))
    .filter(note => Number.isFinite(note.startTimeSeconds)
      && Number.isFinite(note.durationSeconds)
      && note.durationSeconds > 0.03
      && note.startTimeSeconds >= chunk.coreStart
      && (note.startTimeSeconds < chunk.coreEnd || (
        chunk.coreEnd === chunk.renderEnd && note.startTimeSeconds <= chunk.coreEnd)));
}

export function mergeChunkNotes<T extends TimedNote>(notes: T[]): T[] {
  const sorted = notes.slice().sort((a,b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  const result: T[] = [];
  for (const note of sorted) {
    const duplicate = result.slice(-30).some(other =>
      other.pitchMidi === note.pitchMidi
      && Math.abs(other.startTimeSeconds - note.startTimeSeconds) < 0.06
      && Math.abs(other.durationSeconds - note.durationSeconds) < 0.15);
    if (!duplicate) result.push(note);
  }
  return result;
}
