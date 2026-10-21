/**
 * Optional, user-entered sustain pedal controller events (MIDI CC64).
 * MuScriptor predicts notes only: these events are NOT inferred from audio.
 * Pedal timing is tracked in seconds and never changes detected note data.
 */
export type PedalEvent = {
  trackKey: string; // '*' affects every non-drum MIDI track
  timeSeconds: number;
  value: 0 | 127;
};
type NoteSpan = { startTimeSeconds: number; durationSeconds: number };
type PedalTrack = { key: string; isDrum: boolean; notes: NoteSpan[] };

export function addPedalPoint(existing: PedalEvent[], event: PedalEvent): PedalEvent[] {
  if (!event.trackKey || !Number.isFinite(event.timeSeconds) ||
    event.timeSeconds < 0 || event.timeSeconds > 900 ||
    (event.value !== 0 && event.value !== 127)) return existing;
  const timeSeconds = Math.round(event.timeSeconds * 1000) / 1000;
  return [...existing.filter(point =>
    !(point.trackKey === event.trackKey && Math.abs(point.timeSeconds - timeSeconds) < 0.001)),
    { ...event, timeSeconds }]
    .sort((a,b) => a.timeSeconds-b.timeSeconds || a.trackKey.localeCompare(b.trackKey));
}

export function eventsForPedalTrack(track: PedalTrack, events: PedalEvent[]): PedalEvent[] {
  if (track.isDrum || !track.notes.length) return [];
  const lastNoteEnd = Math.max(0, ...track.notes.map(note =>
    note.startTimeSeconds + note.durationSeconds));
  const applicable = events
    .filter(event => (event.trackKey === '*' || event.trackKey === track.key) &&
      Number.isFinite(event.timeSeconds) && event.timeSeconds >= 0 &&
      event.timeSeconds <= lastNoteEnd + 8 &&
      (event.value === 0 || event.value === 127))
    .sort((a,b) => a.timeSeconds - b.timeSeconds ||
      (a.trackKey === '*' ? -1 : 1)); // track-specific event wins a simultaneous global event
  const result: PedalEvent[] = [];
  let down = false;
  for (const event of applicable) {
    if (event.value === 127 && event.timeSeconds > lastNoteEnd) continue;
    const nextDown = event.value === 127;
    if (nextDown === down) continue;
    down = nextDown;
    result.push({ trackKey: track.key, timeSeconds: event.timeSeconds, value: event.value });
  }
  // Never leave pedal down after an exported MIDI file ends.
  if (down) result.push({trackKey:track.key,timeSeconds:lastNoteEnd + 0.01,value:0});
  return result;
}
