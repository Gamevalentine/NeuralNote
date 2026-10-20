
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AudioWaveform, CircleHelp, Gauge, Headphones, Info, LoaderCircle,
  Music, Settings2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { fmt, generateDemo, groupFor, GROUPS, noteName, readAudio, transcribe } from './audio';
import { assertSupportedSong, MAX_SONG_BYTES, MAX_SONG_SECONDS } from './longAudio';
import { createDawMidi, createDawBundle, extractDawTracks, midiChannelLimitExceeded } from './dawMidi';
import { addNote, copyNotes, removeNote, sameNotes, SNAP_SECONDS, snapSeconds, updateNote, clamp } from './pianoEdit';
import type { Note, AudioInfo, PitchGroup } from './audio';
import { DEFAULT_INSTRUMENTS, INSTRUMENTS, instrumentProgram, playSoundfontNote, prepareInstrument } from './soundfont';
import type { InstrumentId, InstrumentSelection } from './soundfont';
import { nativeInstrumentPrograms, nativeProgramName } from './muscriptorProtocol';
import { nativeBridgeAvailable, runMuScriptor } from './muscriptorNative';

type Selection = { file: Blob; name: string; url: string };
type Phase = 'empty' | 'ready' | 'analyzing' | 'complete' | 'error';
type PlaybackMode = 'original' | 'midi' | 'mix';
type MenuKey = 'file' | 'edit' | 'play' | 'track' | 'instrument' | 'tools' | 'view' | 'export';
type MenuAction = { label: string; run: () => void; disabled?: boolean; checked?: boolean; shortcut?: string };
type AppMenu = { id: MenuKey; label: string; commands: MenuAction[] };
type NoteGesture = {
  pointerId: number; index: number; kind: 'move' | 'resize';
  startX: number; startY: number; original: Note; before: Note[];
};
const PITCH_ROW = 16;
// UI-only review of the future Desktop layout. This does not enable MuScriptor in the browser.
const desktopReview = new URLSearchParams(window.location.search).get('review') === 'desktop';
const midiColor = (pitch: number) => GROUPS.find(group => group.id === groupFor(pitch))?.color || '#59bfa3';
const nativeTrackColors = ['#e4b45b', '#47bda0', '#8b83ec', '#79bcf5', '#d988ae', '#f09d6c', '#a6cc73'];
const nativeTrackColor = (program: number) => nativeTrackColors[Math.abs(program) % nativeTrackColors.length];
const nativeSoundfontPreset = (program: number): InstrumentId =>
  program < 8 ? 'acoustic_grand_piano'
  : program >= 24 && program < 32 ? 'acoustic_guitar_nylon'
  : program >= 32 && program < 40 ? 'electric_bass_finger'
  : program >= 40 && program < 52 ? 'violin'
  : program >= 72 && program < 80 ? 'flute'
  : program >= 8 && program < 16 ? 'marimba'
  : 'acoustic_grand_piano';

function App() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [info, setInfo] = useState<AudioInfo | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [phase, setPhase] = useState<Phase>('empty');
  const [engineMode, setEngineMode] = useState<'basic' | 'muscriptor'>('basic');
  const [nativeReady, setNativeReady] = useState(false);
  const [nativeModelInstalled, setNativeModelInstalled] = useState(false);
  const [nativeDownloading, setNativeDownloading] = useState(false);
  const [nativeMuted, setNativeMuted] = useState<Set<number>>(new Set());
  const [nativeSolo, setNativeSolo] = useState<number | null>(null);
  const [nativeSelectedProgram, setNativeSelectedProgram] = useState<number | null>(null);
  const [nativeGain, setNativeGain] = useState<Record<number, number>>({});
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Chưa tải tệp âm thanh');
  const [error, setError] = useState('');
  const [busyLoading, setBusyLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(120);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('mix');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState<Set<PitchGroup>>(new Set());
  const [solo, setSolo] = useState<PitchGroup | null>(null);
  const [gain, setGain] = useState<Record<PitchGroup, number>>({ high: 0.7, mid: 0.7, low: 0.7 });
  const [instrumentSelection, setInstrumentSelection] = useState<InstrumentSelection>({ ...DEFAULT_INSTRUMENTS });
  const [soundfontStatus, setSoundfontStatus] = useState('SoundFont: chọn tiếng để tải mẫu');
  const [loadingSoundfont, setLoadingSoundfont] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.65);
  const [showSettings, setShowSettings] = useState(false);
  const [showDawHelp, setShowDawHelp] = useState(false);
  const [showDesktopReview, setShowDesktopReview] = useState(false);
  const [reviewArea, setReviewArea] = useState<'menu' | 'tracks' | 'roll' | null>(null);
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 43 });
  const audioEl = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const keyColumn = useRef<HTMLDivElement>(null);
  const timelineViewport = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const audioCtx = useRef<AudioContext | null>(null);
  const midiOnlyStart = useRef<number | null>(null);
  const firedNotes = useRef<Set<number>>(new Set());
  const previousTime = useRef(0);
  const selectionRef = useRef<Selection | null>(null);
  const recognitionInFlight = useRef(false);
  const notesRef = useRef<Note[]>([]);
  const undoRef = useRef<Note[][]>([]);
  const redoRef = useRef<Note[][]>([]);
  const gestureRef = useRef<NoteGesture | null>(null);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => {
    if (!nativeBridgeAvailable()) return;
    let mounted = true;
    void window.notiqNative!.status().then(native => {
      if (!mounted || !native.available) return;
      setNativeReady(true);
      setNativeModelInstalled(native.modelInstalled);
      setEngineMode('muscriptor');
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  useEffect(() => () => {
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    if (audioCtx.current) void audioCtx.current.close().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setActiveMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActiveMenu(null); setShowSettings(false); setShowDesktopReview(false); setReviewArea(null); }
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onOutside); document.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => {
    const node = timelineViewport.current;
    if (!node) return;
    const measure = () => setViewportWidth(Math.max(1, Math.floor(node.clientWidth)));
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  const pitchBottom = Math.min(36, notes.length ? Math.max(21, Math.floor(Math.min(...notes.map(n => n.pitchMidi)) / 12) * 12) : 36);
  const pitchTop = Math.max(92, notes.length ? Math.min(108, Math.ceil(Math.max(...notes.map(n => n.pitchMidi)) / 12) * 12 + 11) : 92);
  const gridHeight = (pitchTop - pitchBottom + 1) * PITCH_ROW;
  const pitches = Array.from({ length: pitchTop - pitchBottom + 1 }, (_, i) => pitchTop - i);
  const totalSeconds = Math.max(1, info?.duration || 8);
  // Fill the available editor width on large monitors; allow horizontal scrolling when zoomed in.
  const timelineWidth = Math.max(1000, viewportWidth, Math.round(totalSeconds * 80 * zoom));
  const activeGroups = useMemo(
    () => new Set(GROUPS.filter(g => !muted.has(g.id) && (!solo || solo === g.id)).map(g => g.id)),
    [muted, solo],
  );
  const hasNativeTracks = notes.some(n => n.program !== undefined);
  const nativePrograms = useMemo(() => nativeInstrumentPrograms(notes), [notes]);
  const isNoteAudible = (n: Note) => n.program !== undefined
    ? !nativeMuted.has(n.program) && (nativeSolo === null || nativeSolo === n.program)
    : activeGroups.has(groupFor(n.pitchMidi));
  const visibleNotes = useMemo(() => notes.filter(isNoteAudible),
    [notes, activeGroups, nativeMuted, nativeSolo]);
  const visibleIndexedNotes = useMemo(() => notes.map((note,index) => ({note,index})).filter(({note}) => isNoteAudible(note)),
    [notes, activeGroups, nativeMuted, nativeSolo]);
  const canUndo = historyTick >= 0 && undoRef.current.length > 0;
  const canRedo = historyTick >= 0 && redoRef.current.length > 0;
  const summary = useMemo(() => {
    if (!notes.length) return 'Chưa có nốt';
    const pitches = notes.map(n => n.pitchMidi);
    return notes.length.toLocaleString('vi-VN') + ' nốt · ' + noteName(Math.min(...pitches)) + ' – ' + noteName(Math.max(...pitches));
  }, [notes]);

  const clearHistory = (next: Note[] = []) => {
    undoRef.current = [];
    redoRef.current = [];
    gestureRef.current = null;
    notesRef.current = next;
    setNotes(next);
    setSelectedNote(null);
    setHistoryTick(tick => tick + 1);
  };

  const commitNotes = (next: Note[]) => {
    if (phase === 'analyzing' || sameNotes(next, notesRef.current)) return;
    undoRef.current = [...undoRef.current.slice(-49), copyNotes(notesRef.current)];
    redoRef.current = [];
    notesRef.current = next;
    setNotes(next);
    firedNotes.current.clear();
    setHistoryTick(tick => tick + 1);
  };

  const undoEdit = () => {
    if (phase === 'analyzing') return;
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(copyNotes(notesRef.current));
    notesRef.current = previous;
    setNotes(previous);
    setSelectedNote(null);
    firedNotes.current.clear();
    setHistoryTick(tick => tick + 1);
  };

  const redoEdit = () => {
    if (phase === 'analyzing') return;
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(copyNotes(notesRef.current));
    notesRef.current = next;
    setNotes(next);
    setSelectedNote(null);
    firedNotes.current.clear();
    setHistoryTick(tick => tick + 1);
  };

  const deleteSelected = () => {
    if (selectedNote === null || phase === 'analyzing') return;
    commitNotes(removeNote(notesRef.current, selectedNote));
    setSelectedNote(null);
  };

  const setAudio = async (file: Blob, name: string) => {
    if (phase === 'analyzing' || recognitionInFlight.current || busyLoading) return;
    if (!/\.(wav|mp3|flac|ogg|m4a|aac|aiff)$/i.test(name)) {
      setError('Định dạng chưa hỗ trợ. Hãy chọn WAV, MP3, FLAC, OGG hoặc M4A phù hợp với trình duyệt.');
      setPhase('error');
      return;
    }
    if (file.size > MAX_SONG_BYTES) {
      setError('Tệp lớn hơn 200 MB. Hãy thử tệp MP3/FLAC nhỏ hơn hoặc chọn một bài khác.');
      setPhase('error');
      return;
    }
    setBusyLoading(true);
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    selectionRef.current = null;
    setSelection(null);
    setError('');
    setPlaying(false);
    clearHistory();
    setInfo(null);
    setTime(0);
    setProgress(0);
    firedNotes.current.clear();
    if (audioEl.current) audioEl.current.pause();
    try {
      const decoded = await readAudio(file);
      assertSupportedSong(decoded.duration);
      const next = { file, name, url: URL.createObjectURL(file) };
      selectionRef.current = next;
      setSelection(next);
      setInfo(decoded);
      setPhase('ready');
      if (engineMode === 'muscriptor' && (!nativeReady || !nativeModelInstalled)) {
        setStatus('Đã tải bài hát · Cần mô hình MuScriptor để nhận diện');
        setError('MuScriptor chưa có mô hình 209 MB. Nhấn “Tải mô hình AI” trên thanh trên cùng để tiếp tục.');
      } else {
        setStatus('Đã tải bài hát · Đang khởi động AI…');
        // Start directly with the selected blob, not the previous React selection.
        // This removes the extra hidden "Tools → Transcribe" step entirely.
        void runRecognition(next);
      }
    } catch (cause) {
      setPhase('error');
      setStatus('Không thể mở âm thanh');
      setError(cause instanceof Error ? cause.message : 'Không thể đọc tệp.');
    } finally {
      setBusyLoading(false);
    }
  };

  const downloadNativeModel = async () => {
    if (!nativeReady || !window.notiqNative || nativeDownloading) return;
    const bridge = window.notiqNative;
    const detach = bridge.onProgress(({kind, percent, message}) => {
      if (kind === 'download') {
        setStatus(message);
        setProgress(percent);
      }
    });
    setNativeDownloading(true);
    setError('');
    setProgress(0);
    try {
      const result = await bridge.downloadModel();
      setNativeModelInstalled(result.modelInstalled);
      setStatus(result.modelInstalled ? 'MuScriptor Small đã sẵn sàng' : 'Model MuScriptor chưa hoàn tất');
      if (result.modelInstalled && selectionRef.current && engineMode === 'muscriptor')
        void runRecognition(selectionRef.current, 'muscriptor', true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được mô hình MuScriptor');
    } finally {
      detach();
      setNativeDownloading(false);
    }
  };

  const runRecognition = async (
    target: Selection, mode: 'basic' | 'muscriptor' = engineMode, modelJustInstalled = false,
  ) => {
    if (recognitionInFlight.current) return;
    if (mode === 'muscriptor' && (!nativeReady || (!nativeModelInstalled && !modelJustInstalled))) {
      setPhase('ready');
      setStatus('Chưa có mô hình MuScriptor · Cần tải AI để nhận diện');
      setError('Bạn cần tải mô hình MuScriptor Small trong ứng dụng Windows trước khi nhận diện.');
      return;
    }
    recognitionInFlight.current = true;
    if (audioEl.current) audioEl.current.pause();
    setPlaying(false);
    setPhase('analyzing');
    setError('');
    setProgress(0);
    setStatus(mode === 'muscriptor'
      ? 'MuScriptor đang chuẩn bị nhận diện bài hát…'
      : 'Basic Pitch đang tải mô hình và nhận diện bài hát…');
    try {
      const detected = mode === 'muscriptor'
        ? await runMuScriptor(target.file, ({kind, percent, message}) => {
            if (kind === 'transcribe') {
              setStatus(message);
              setProgress(percent);
            }
          })
        : await transcribe(target.file, (message, percentage) => {
            setStatus(message);
            setProgress(percentage);
          });
      clearHistory(detected);
      setNativeMuted(new Set());
      setNativeSolo(null);
      setNativeSelectedProgram(detected.find(n => n.program !== undefined)?.program ?? null);
      setProgress(100);
      setPhase('complete');
      setStatus(mode === 'muscriptor'
        ? 'MuScriptor: ' + detected.length + ' nốt · ' + nativeInstrumentPrograms(detected).length + ' nhạc cụ'
        : 'Basic Pitch: ' + detected.length + ' nốt · đã hoàn tất');
      firedNotes.current.clear();
    } catch (cause) {
      setPhase('error');
      setError((cause instanceof Error ? cause.message : 'Nhận diện thất bại')
        + (mode === 'muscriptor' ? '' : ' · Kiểm tra mạng khi tải Basic Pitch.'));
      setStatus('Không thể nhận diện bài hát · có thể thử lại bằng nút Nhận diện');
    } finally {
      recognitionInFlight.current = false;
    }
  };

  const startInference = () => {
    if (selection) void runRecognition(selection);
  };

  const getAudioContext = () => {
    const ctx = audioCtx.current || new AudioContext();
    audioCtx.current = ctx;
    return ctx;
  };

  const warmInstrument = async (instrument: InstrumentId) => {
    try {
      setLoadingSoundfont(true);
      setSoundfontStatus('Đang tải mẫu SoundFont: ' + (INSTRUMENTS.find(item => item.id === instrument)?.label || instrument));
      const ctx = getAudioContext();
      if (ctx.state !== 'running') await ctx.resume();
      await prepareInstrument(ctx, instrument);
      setSoundfontStatus('SoundFont đã sẵn sàng: ' + (INSTRUMENTS.find(item => item.id === instrument)?.label || instrument));
    } catch (cause) {
      setSoundfontStatus('Không tải được bộ tiếng — kiểm tra kết nối Internet');
      setError('Không tải được mẫu SoundFont FluidR3. '
        + (cause instanceof Error ? cause.message : 'Hãy thử chọn lại tiếng nhạc cụ.'));
    } finally {
      setLoadingSoundfont(false);
    }
  };

  const changeInstrument = (group: PitchGroup, instrument: InstrumentId) => {
    setInstrumentSelection(previous => ({ ...previous, [group]: instrument }));
    void warmInstrument(instrument);
  };

  const previewNote = async (pitch: number, length = 0.35, volume = 0.65, program?: number) => {
    if (program === 128) {
      setSoundfontStatus('Đã nhận diện trống GM; tiếng trống cần bộ sample percussion riêng.');
      return;
    }
    const nativePreset: InstrumentId | undefined = program === undefined ? undefined : nativeSoundfontPreset(program);
    try {
      const ctx = getAudioContext();
      await playSoundfontNote(ctx, nativePreset || instrumentSelection[groupFor(pitch)], pitch, length, volume);
    } catch (cause) {
      setSoundfontStatus('Lỗi tải / phát SoundFont');
      setError('Không thể nghe tiếng nhạc cụ. '
        + (cause instanceof Error ? cause.message : 'Kiểm tra mạng và chọn lại nhạc cụ.'));
    }
  };

  const addNoteAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || phase === 'analyzing') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const y = clamp(event.clientY - rect.top, 0, rect.height - 1);
    const pitch = clamp(pitchTop - Math.floor(y / PITCH_ROW), pitchBottom, pitchTop);
    const next = addNote(notesRef.current, pitch, x / rect.width * totalSeconds, totalSeconds);
    if (hasNativeTracks) {
      const program = nativeSelectedProgram ?? nativePrograms[0];
      next[next.length-1] = { ...next[next.length-1], program, isDrum: program === 128 };
    }
    commitNotes(next);
    setSelectedNote(next.length - 1);
    setStatus('Đã thêm nốt ' + noteName(pitch) + ' · có thể kéo nốt hoặc kéo mép phải');
    void previewNote(pitch);
  };

  const beginNoteGesture = (event: ReactPointerEvent<HTMLButtonElement>, index: number, kind: 'move' | 'resize') => {
    if (event.button !== 0 || phase === 'analyzing') return;
    event.stopPropagation();
    event.preventDefault();
    const original = notesRef.current[index];
    if (!original) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    element.focus();
    gestureRef.current = {
      pointerId: event.pointerId, index, kind, original,
      before: copyNotes(notesRef.current), startX: event.clientX, startY: event.clientY,
    };
    setSelectedNote(index);
    void previewNote(original.pitchMidi, Math.min(0.36, original.durationSeconds), 0.65, original.program);
  };

  const moveNoteGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const deltaSeconds = snapSeconds((event.clientX - gesture.startX) / timelineWidth * totalSeconds);
    const next = gesture.kind === 'move'
      ? updateNote(gesture.before, gesture.index, {
          startTimeSeconds: gesture.original.startTimeSeconds + deltaSeconds,
          pitchMidi: clamp(gesture.original.pitchMidi
            - Math.round((event.clientY - gesture.startY) / PITCH_ROW), pitchBottom, pitchTop),
        }, totalSeconds)
      : updateNote(gesture.before, gesture.index, {
          durationSeconds: gesture.original.durationSeconds + deltaSeconds,
        }, totalSeconds);
    if (sameNotes(next, notesRef.current)) return;
    notesRef.current = next;
    setNotes(next);
  };

  const endNoteGesture = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) {
      notesRef.current = gesture.before;
      setNotes(gesture.before);
    } else if (!sameNotes(gesture.before, notesRef.current)) {
      undoRef.current = [...undoRef.current.slice(-49), gesture.before];
      redoRef.current = [];
      firedNotes.current.clear();
      setHistoryTick(tick => tick + 1);
      const result = notesRef.current[gesture.index];
      if (result) {
        setStatus((gesture.kind === 'resize' ? 'Đã đổi độ dài: ' : 'Đã chuyển nốt: ')
          + noteName(result.pitchMidi) + ' · ' + fmt(result.startTimeSeconds));
        if (gesture.kind === 'move' && result.pitchMidi !== gesture.original.pitchMidi)
          void previewNote(result.pitchMidi, 0.25, 0.65, result.program);
      }
    }
  };

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement
          && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redoEdit(); else undoEdit();
        } else if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redoEdit();
        }
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNote !== null) {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === 'Escape') {
        setSelectedNote(null);
      }
    };
    document.addEventListener('keydown', shortcuts);
    return () => document.removeEventListener('keydown', shortcuts);
  });

  useEffect(() => {
    if (!playing || !notes.length || playbackMode === 'original') return;
    const interval = window.setInterval(() => {
      const now = info ? (audioEl.current?.currentTime || 0)
        : Math.max(0, (audioCtx.current?.currentTime || 0) - (midiOnlyStart.current || 0));
      if (!info) {
        setTime(now);
        if (now >= totalSeconds) {
          if (loop) {
            midiOnlyStart.current = audioCtx.current?.currentTime || null;
            firedNotes.current.clear();
          } else {
            setPlaying(false);
            midiOnlyStart.current = null;
          }
          return;
        }
      }
      if (now + 0.25 < previousTime.current || Math.abs(now - previousTime.current) > 0.5) firedNotes.current.clear();
      previousTime.current = now;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const group = groupFor(n.pitchMidi);
        if (!isNoteAudible(n) || firedNotes.current.has(i)) continue;
        if (n.startTimeSeconds >= now - 0.10 && n.startTimeSeconds <= now + 0.055) {
          firedNotes.current.add(i);
          const level = n.program === undefined ? gain[group] : (nativeGain[n.program] ?? 0.7);
          void previewNote(n.pitchMidi, Math.min(0.85, n.durationSeconds), level * masterVolume, n.program);
        }
      }
    }, 45);
    return () => window.clearInterval(interval);
  }, [playing, notes, playbackMode, activeGroups, gain, masterVolume, info, totalSeconds, loop, instrumentSelection, nativeGain, nativeMuted, nativeSolo]);

  useEffect(() => {
    if (audioEl.current) audioEl.current.volume = playbackMode === 'midi' ? 0 : masterVolume * (playbackMode === 'mix' ? 0.65 : 1);
  }, [playbackMode, masterVolume, selection]);

  const togglePlayback = async () => {
    const audio = audioEl.current;
    if (!info && !visibleNotes.length) return;
    if (playing) {
      audio?.pause();
      midiOnlyStart.current = null;
      setPlaying(false);
    } else {
      try {
        const ctx = getAudioContext();
        if (ctx.state !== 'running') await ctx.resume();
        if (playbackMode !== 'original' || !info) {
          const needed = [...new Set(visibleNotes.filter(n => n.program !== 128).map(n => n.program === undefined ? instrumentSelection[groupFor(n.pitchMidi)] : nativeSoundfontPreset(n.program)))];
          if (needed.length) {
            setLoadingSoundfont(true);
            setSoundfontStatus('Đang chuẩn bị các tiếng SoundFont để phát MIDI...');
            await Promise.all(needed.map(instrument => prepareInstrument(ctx, instrument)));
            setSoundfontStatus('Đã tải xong ' + needed.length + ' bộ tiếng SoundFont');
          }
        }
        firedNotes.current.clear();
        previousTime.current = info ? (audio?.currentTime || 0) : 0;
        if (info && audio) await audio.play();
        else { midiOnlyStart.current = ctx.currentTime; setTime(0); }
        setPlaying(true);
      } catch (cause) {
        setSoundfontStatus('Lỗi SoundFont / phát lại');
        setError('Không thể chuẩn bị bộ tiếng: ' + (cause instanceof Error ? cause.message : 'Kiểm tra mạng hoặc thử chọn lại nhạc cụ.'));
      } finally {
        setLoadingSoundfont(false);
      }
    }
  };
  const seekTo = (seconds: number) => {
    const clamped = Math.max(0, Math.min(info?.duration || totalSeconds, seconds));
    if (info && audioEl.current) audioEl.current.currentTime = clamped;
    else if (midiOnlyStart.current !== null && audioCtx.current)
      midiOnlyStart.current = audioCtx.current.currentTime - clamped;
    setTime(clamped);
    previousTime.current = clamped;
    firedNotes.current.clear();
  };
  const stop = () => {
    if (audioEl.current) audioEl.current.pause();
    setPlaying(false);
    midiOnlyStart.current = null;
    seekTo(0);
  };
  const toggleMute = (id: PitchGroup) => {
    setMuted(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const downloadResult = (bytes: Uint8Array, filename: string, type: string) => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const blob = new Blob([buffer], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const exportFile = (kind: 'multitrack' | 'bundle' = 'multitrack', scope: 'all' | 'audible' = 'all') => {
    const source = scope === 'all' ? notes : visibleNotes;
    if (!source.length) {
      setStatus('Không có nốt MIDI để xuất.');
      return;
    }
    const programs: Record<PitchGroup, number> = {
      high: instrumentProgram(instrumentSelection.high),
      mid: instrumentProgram(instrumentSelection.mid),
      low: instrumentProgram(instrumentSelection.low),
    };
    const tracks = extractDawTracks(source, programs, scope === 'all'
      ? new Set<PitchGroup>(['high', 'mid', 'low']) : activeGroups);
    if (!tracks.length) {
      setStatus('Không có track MIDI hợp lệ.');
      return;
    }
    const basename = (selection?.name.replace(/\.[^.]+$/, '') || 'NOTIQ')
      .replace(/[\\/:*?"<>|]/g, '_').slice(0, 90);
    if (kind === 'bundle') {
      downloadResult(createDawBundle(tracks, bpm), basename + '_DAW_KONTAKT.zip', 'application/zip');
      setStatus('Đã xuất ' + tracks.length + ' track MIDI riêng + hướng dẫn Kontakt');
    } else {
      downloadResult(createDawMidi(tracks, bpm), basename + '_MULTITRACK.mid', 'audio/midi');
      setStatus('Đã xuất MIDI Type 1: ' + tracks.length + ' track');
    }
    if (midiChannelLimitExceeded(tracks))
      setError('Vượt 15 nhạc cụ giai điệu trên 1 cổng GM. Dùng gói ZIP MIDI riêng từng track để tránh trùng kênh trong DAW.');
  };
  const reset = () => {
    stop();
    setSelection(null);
    setInfo(null);
    clearHistory();
    setTime(0);
    setPhase('empty');
    setError('');
    setProgress(0);
    setStatus('Chưa tải tệp âm thanh');
    firedNotes.current.clear();
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    selectionRef.current = null;
  };
  const markers = Array.from({ length: Math.ceil(totalSeconds) + 1 }, (_, i) => i);
  const cursorX = time / totalSeconds * timelineWidth;
  const onDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      void setAudio(file, file.name);
    }
  };

  const menus: AppMenu[] = [
    {
      id: 'file', label: 'Tệp', commands: [
        { label: 'Tải bài hát / mở âm thanh…', run: () => fileInput.current?.click(), disabled: busyLoading || phase === 'analyzing' },
        { label: 'Dùng nhạc mẫu', run: () => void setAudio(generateDemo(), 'NOTIQ - giai điệu mẫu.wav'), disabled: busyLoading || phase === 'analyzing' },
        { label: 'Đóng tệp đang mở', run: reset, disabled: !selection || phase === 'analyzing' },
      ],
    },
    {
      id: 'edit', label: 'Chỉnh sửa', commands: [
        { label: 'Hoàn tác (Undo)', run: undoEdit, disabled: !canUndo || phase === 'analyzing', shortcut: 'Ctrl+Z' },
        { label: 'Làm lại (Redo)', run: redoEdit, disabled: !canRedo || phase === 'analyzing', shortcut: 'Ctrl+Y' },
        { label: 'Xóa nốt đã chọn', run: deleteSelected, disabled: selectedNote === null || phase === 'analyzing', shortcut: 'Del' },
        { label: 'Xóa kết quả nhận diện', run: () => { commitNotes([]); setSelectedNote(null); setPhase(selection ? 'ready' : 'empty'); setStatus('Đã xóa kết quả MIDI'); }, disabled: notes.length === 0 || phase === 'analyzing' },
        { label: 'Về đầu bản nhạc', run: () => seekTo(0), disabled: !info && !notes.length },
      ],
    },
    {
      id: 'play', label: 'Phát lại', commands: [
        { label: playing ? 'Tạm dừng' : 'Phát', run: () => void togglePlayback(), disabled: !info && !notes.length },
        { label: 'Dừng và về đầu', run: stop, disabled: !info && !notes.length },
        { label: 'Phát lặp', run: () => setLoop(v => !v), checked: loop },
      ],
    },
    {
      id: 'track', label: 'Track MIDI', commands: [
        { label: 'Bật tất cả dải nốt', run: () => { setMuted(new Set()); setSolo(null); } },
        { label: 'Tắt tiếng tất cả', run: () => { setMuted(new Set(GROUPS.map(g => g.id))); setSolo(null); } },
        ...GROUPS.map(group => ({
          label: 'Bật/tắt ' + group.name.toLowerCase(),
          run: () => toggleMute(group.id),
          checked: !muted.has(group.id),
        })),
      ],
    },
    {
      id: 'instrument', label: 'Nhạc cụ', commands: [
        ...GROUPS.map(group => ({
          label: 'Chỉ nghe ' + group.name.toLowerCase(),
          run: () => setSolo(solo === group.id ? null : group.id),
          checked: solo === group.id,
        })),
        { label: 'Thông tin AI nhận diện', run: () => setShowSettings(true) },
      ],
    },
    {
      id: 'tools', label: 'Công cụ', commands: [
        { label: phase === 'analyzing' ? 'Đang nhận diện…' : 'Nhận diện Audio → MIDI', run: () => void startInference(), disabled: !selection || phase === 'analyzing' },
        { label: 'AI: Basic Pitch (Web)', run: () => setEngineMode('basic'), checked: engineMode === 'basic', disabled: phase === 'analyzing' },
        { label: nativeReady ? 'AI: MuScriptor C++ (Windows)' : 'MuScriptor C++ (chỉ có trên NOTIQ Windows)',
          run: () => setEngineMode('muscriptor'), disabled: !nativeReady || phase === 'analyzing',
          checked: engineMode === 'muscriptor' },
        ...(nativeReady ? [{
          label: nativeModelInstalled ? 'MuScriptor Small — đã tải (209 MB)' :
            nativeDownloading ? 'Đang tải mô hình MuScriptor…' : 'Tải mô hình MuScriptor Small (209 MB)',
          run: () => void downloadNativeModel(), disabled: nativeDownloading || nativeModelInstalled,
        }] : []),
        { label: 'Cài đặt NOTIQ', run: () => setShowSettings(true) },
      ],
    },
    {
      id: 'view', label: 'Hiển thị', commands: [
        { label: 'Phóng to timeline', run: () => setZoom(z => Math.min(4, z * 1.25)) },
        { label: 'Thu nhỏ timeline', run: () => setZoom(z => Math.max(0.5, z / 1.25)) },
        { label: 'Trở về 100%', run: () => setZoom(1) },
      ],
    },
    {
      id: 'export', label: 'Xuất', commands: [
        { label: 'MIDI đa track (.mid) · Cubase/Cakewalk', run: () => exportFile('multitrack'), disabled: !notes.length },
        { label: 'Gói MIDI từng track (.zip) · Kontakt', run: () => exportFile('bundle'), disabled: !notes.length },
        { label: 'Chỉ xuất track đang bật (.mid)', run: () => exportFile('multitrack', 'audible'), disabled: !visibleNotes.length },
        { label: 'Chỉ đóng gói track đang bật (.zip)', run: () => exportFile('bundle', 'audible'), disabled: !visibleNotes.length },
        { label: 'Hướng dẫn sử dụng Kontakt', run: () => setShowDawHelp(true) },
      ],
    },
  ];
  const toggleMenu = (key: MenuKey, node: HTMLButtonElement) => {
    const rect = node.getBoundingClientRect();
    setMenuPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 276)), top: rect.bottom + 2 });
    setActiveMenu(previous => previous === key ? null : key);
    setShowSettings(false);
  };

  return (
    <main className="notiq-app">
      <audio
        key={selection?.url || 'empty'} ref={audioEl} src={selection?.url} preload="auto"
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onEnded={() => {
          if (loop && audioEl.current) {
            audioEl.current.currentTime = 0;
            firedNotes.current.clear();
            void audioEl.current.play();
          } else setPlaying(false);
        }}
      />

      <header className={"osbar" + (reviewArea === "menu" ? " ui-review-highlight" : "")} ref={menuRef}>
        <span className="os-title"><AudioWaveform size={17} /> <strong>NOTIQ</strong><b>WEB STUDIO</b></span>
        <nav className="app-menu-items" aria-label="Menu chính">
          {menus.map(menu => (
            <div className="menu-slot" key={menu.id}>
              <button type="button" className={'menu-trigger' + (activeMenu === menu.id ? ' active' : '')}
                aria-expanded={activeMenu === menu.id} aria-haspopup="true"
                onClick={event => toggleMenu(menu.id, event.currentTarget)}>
                {menu.label}
              </button>
              {activeMenu === menu.id && (
                <div className="menu-dropdown" role="group" aria-label={menu.label} style={{ left: menuPosition.left, top: menuPosition.top }}>
                  {menu.commands.map(command => (
                    <button key={command.label} type="button" className="menu-command"
                      disabled={command.disabled} onClick={() => { command.run(); setActiveMenu(null); }}>
                      <span className="menu-checked">{command.checked ? '✓' : ''}</span>
                      <span className="menu-command-name">{command.label}</span>
                      {command.shortcut && <span className="menu-shortcut">{command.shortcut}</span>}
                    </button>
                  ))}
                  {menu.id === 'play' && (
                    <div className="menu-settings">
                      <label htmlFor="playmode-menu">Chế độ nghe</label>
                      <select id="playmode-menu" value={playbackMode} onChange={event => setPlaybackMode(event.target.value as PlaybackMode)}>
                        <option value="mix">Âm gốc + MIDI</option>
                        <option value="original">Chỉ âm gốc</option>
                        <option value="midi">Chỉ MIDI</option>
                      </select>
                      <label htmlFor="volume-menu">Âm lượng {Math.round(masterVolume * 100)}%</label>
                      <input id="volume-menu" type="range" min={0} max={1} step={0.01} value={masterVolume} onChange={event => setMasterVolume(Number(event.target.value))}/>
                    </div>
                  )}
                  {menu.id === 'tools' && (
                    <div className="menu-settings menu-settings-row">
                      <label htmlFor="bpm-menu">BPM xuất MIDI</label>
                      <input id="bpm-menu" type="number" min={40} max={240} value={bpm} onChange={event => setBpm(Math.min(240, Math.max(40, Number(event.target.value) || 120)))}/>
                      <small>AI: Spotify Basic Pitch</small>
                    </div>
                  )}
                  {menu.id === 'instrument' && <p className="menu-note">Các mục này chỉ lọc dải cao độ. AI chưa phân loại Piano, Guitar hay Drums.</p>}
                  {menu.id === 'export' && <p className="menu-note">Xuất các nốt đã nhận diện thành tệp MIDI.</p>}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="os-actions">
          <button type="button" className="song-upload-btn"
            disabled={busyLoading || phase === 'analyzing'}
            onClick={() => fileInput.current?.click()}
            title="Mở bài hát đầy đủ (WAV, MP3, FLAC, M4A… · tối đa 15 phút / 200 MB)">
            <Music size={14}/> Tải bài hát
          </button>
          <span className="lunor">LUNOR <b>MUSIC</b></span>
          <a href="https://github.com/Gamevalentine/NeuralNote" target="_blank" rel="noreferrer">Mã nguồn ↗</a>
          {desktopReview && <button type="button" className="desktop-review-toggle" aria-expanded={showDesktopReview} onClick={() => { setActiveMenu(null); setShowSettings(false); setShowDesktopReview(value => !value); }}><Info size={14}/> Duyệt Desktop <span>UI v0.3</span></button>}
          <button type="button" className="os-settings" onClick={() => { setActiveMenu(null); setShowSettings(!showSettings); }} title="Cài đặt" aria-label="Cài đặt"><Settings2 size={16} /></button>
        </div>
      </header>
      {desktopReview && showDesktopReview && <section className="desktop-review-panel" aria-label="Duyệt giao diện NOTIQ Desktop">
        <div className="desktop-review-head"><strong>NOTIQ Desktop · Bản duyệt giao diện</strong><button type="button" aria-label="Đóng bảng duyệt" onClick={() => { setShowDesktopReview(false); setReviewArea(null); }}><X size={16}/></button></div>
        <p>Trang này là bản mẫu giao diện để bạn xem trước khi tải Desktop. Các nút, nhóm nốt và Piano Roll bên dưới vẫn hoạt động theo engine Web.</p>
        <strong className="desktop-review-subtitle">Chọn vùng muốn kiểm tra</strong>
        <div className="desktop-review-areas">
          {([
            ['menu', 'Thanh menu'],
            ['tracks', 'Nhóm nốt'],
            ['roll', 'Piano Roll'],
          ] as const).map(([id, label]) => <button key={id} type="button" className={reviewArea === id ? 'selected' : ''} aria-pressed={reviewArea === id} onClick={() => setReviewArea(current => current === id ? null : id)}>{label}</button>)}
        </div>
        <p className="desktop-review-note"><strong>Chưa nghiệm thu bản Windows.</strong> Web dùng Basic Pitch; bản Desktop dùng MuScriptor và SoundFont. Khi giao diện được bạn duyệt, mình mới đóng gói bản Windows để kiểm thử âm thanh và AI.</p>
        <span className="desktop-review-help">Chỗ nào chưa giống ý bạn, hãy chụp màn hình và gửi trong cuộc trò chuyện.</span>
      </section>}
      {showDawHelp && <section className="daw-help-popup" role="dialog" aria-modal="false" aria-label="Kết nối Cubase, Cakewalk và Kontakt">
        <div className="daw-help-head"><strong>NOTIQ → Cubase / Cakewalk / Kontakt</strong>
          <button type="button" aria-label="Đóng hướng dẫn" onClick={() => setShowDawHelp(false)}><X size={16}/></button>
        </div>
        <p><strong>1.</strong> Chọn <b>Xuất → Gói MIDI từng track (.zip)</b>, rồi giải nén. Thư mục có MIDI đa track và từng track riêng.</p>
        <p><strong>2.</strong> Trong Cubase hoặc Cakewalk, nhập <code>NOTIQ_ALL_TRACKS.mid</code> vào các MIDI track riêng. Giữ BPM xuất là <strong>{bpm}</strong> nếu DAW không đọc tự động.</p>
        <p><strong>3.</strong> Với Kontakt, tạo instrument cho từng track, chọn thư viện <code>.nki</code> tương ứng rồi định tuyến MIDI track vào Kontakt.</p>
        <p><strong>4.</strong> Track trống dùng <b>MIDI channel 10</b> và nốt GM Drum Kit; gán bộ trống thay vì Kontakt Piano.</p>
        <p className="daw-help-note">Mã GM giúp nhận diện loại nhạc cụ nhưng <strong>không tự chọn file Kontakt .nki</strong>. Nếu nhiều hơn 15 nhạc cụ giai điệu, dùng các MIDI riêng trong ZIP để tránh trùng kênh.</p>
        <button type="button" className="daw-help-close" onClick={() => setShowDawHelp(false)}>Đã hiểu</button>
      </section>}
      {showSettings && <div className="settings-popup">
        <div className="popup-head"><strong><Gauge size={17} /> Tùy chọn NOTIQ</strong><button aria-label="Đóng" onClick={() => setShowSettings(false)}><X size={16} /></button></div>
        <label>Tempo xuất MIDI (BPM)<input type="number" min={40} max={240} value={bpm} onChange={e => setBpm(Math.min(240, Math.max(40, Number(e.target.value) || 120)))} /></label>
        <p>Hỗ trợ tải cả bài hát: tối đa {MAX_SONG_SECONDS / 60} phút · 200 MB. AI xử lý theo từng đoạn và ghép nốt.</p>
        <p>Âm thanh xử lý tại thiết bị của bạn. Mô hình AI tải qua Internet khi cần.</p>
        <p>{nativeReady
          ? 'Bản Windows có MuScriptor C++ CPU. Mô hình Small 209 MB, giấy phép CC BY-NC 4.0 (phi thương mại).'
          : 'Cloudflare Web chỉ chạy Basic Pitch; MuScriptor C++ cần ứng dụng Windows được đóng gói native.'}</p>
        {nativeReady && <p><strong>{nativeModelInstalled ? 'MuScriptor Small đã sẵn sàng' : 'MuScriptor Small chưa tải'}</strong>
          {!nativeModelInstalled && <button type="button" disabled={nativeDownloading}
            onClick={() => void downloadNativeModel()}>{nativeDownloading ? 'Đang tải model…' : 'Tải mô hình Small · 209 MB'}</button>}</p>}
      </div>}
      <div className="studio">
        <aside className={"sidebar" + (reviewArea === "tracks" ? " ui-review-highlight" : "")}>
          <div className="sidebar-heading">
            <span>{hasNativeTracks ? 'TRACK NHẠC CỤ AI' : 'NHÓM NỐT / DẢI ÂM'}</span>
            <span>{hasNativeTracks ? nativePrograms.length : (notes.length ? GROUPS.length : 0)}</span>
          </div>
          <div className="track-explainer">{hasNativeTracks
            ? 'MuScriptor · mỗi track mang mã nhạc cụ GM thật'
            : 'Basic Pitch • nhóm theo cao độ'}</div>
          {hasNativeTracks ? nativePrograms.map(program => {
            const count = notes.filter(note => note.program === program).length;
            const mutedTrack = nativeMuted.has(program);
            const selected = nativeSelectedProgram === program;
            return <div className={'track-card native-track-card' + (mutedTrack ? ' is-muted' : '') + (selected ? ' active-track' : '')}
              key={'gm-' + program}>
              <div className="track-title-row">
                <div className="track-icon" style={{
                  color: nativeTrackColor(program), borderColor: nativeTrackColor(program),
                  backgroundColor: nativeTrackColor(program) + '18',
                }}>{program === 128 ? 'DR' : String(program + 1)}</div>
                <button type="button" className="native-track-select" onClick={() => setNativeSelectedProgram(program)}
                  title={'Chọn track ' + nativeProgramName(program) + ' để thêm nốt mới'}>
                  <strong>{nativeProgramName(program)}</strong><small>{count} nốt · {program === 128 ? 'GM Drum channel 10' : 'Program ' + (program + 1)}</small>
                </button>
                <button type="button" className={'tiny-toggle ' + (mutedTrack ? 'selected' : '')}
                  onClick={() => setNativeMuted(previous => {
                    const next = new Set(previous);
                    if (next.has(program)) next.delete(program); else next.add(program);
                    return next;
                  })}>M</button>
                <button type="button" className={'tiny-toggle ' + (nativeSolo === program ? 'selected' : '')}
                  onClick={() => setNativeSolo(current => current === program ? null : program)}>S</button>
              </div>
              <div className="track-slider-row">
                <span style={{ color: nativeTrackColor(program) }}>▰</span>
                <input aria-label={'Âm lượng ' + nativeProgramName(program)} type="range"
                  min={0} max={1} step={0.01} value={nativeGain[program] ?? 0.7}
                  onChange={event => setNativeGain(previous => ({ ...previous, [program]: Number(event.target.value) }))}/>
                <span>{Math.round((nativeGain[program] ?? 0.7)*100)}%</span>
              </div>
            </div>;
          }) : GROUPS.map(group => {
            const count = notes.filter(n => groupFor(n.pitchMidi) === group.id).length;
            const inactive = !activeGroups.has(group.id);
            return (
              <div className={'track-card ' + (inactive ? 'is-muted' : '')} key={group.id}>
                <div className="track-title-row">
                  <div className="track-icon" style={{ color: group.color, borderColor: group.color + '80', backgroundColor: group.color + '18' }}>{group.code}</div>
                  <div className="track-label"><strong>{group.name}</strong><small>{count} nốt · {group.id === 'high' ? 'C5 trở lên' : group.id === 'mid' ? 'C4 – B4' : 'dưới C4'}</small></div>
                  <button className={'tiny-toggle ' + (muted.has(group.id) ? 'selected' : '')} onClick={() => toggleMute(group.id)} title="Bật/tắt dải này">M</button>
                  <button className={'tiny-toggle ' + (solo === group.id ? 'selected' : '')} onClick={() => setSolo(solo === group.id ? null : group.id)} title="Chỉ nghe dải này">S</button>
                </div>
                <div className="track-slider-row"><span style={{ color: group.color }}>▰</span><input aria-label={'Âm lượng ' + group.name} type="range" min={0} max={1} step={0.01} value={gain[group.id]} onChange={e => setGain(prev => ({...prev, [group.id]: Number(e.target.value)}))}/><span>{Math.round(gain[group.id] * 100)}%</span></div>
                <div className="track-preset-row">
                  <select aria-label={'Chọn tiếng nhạc cụ cho ' + group.name}
                    value={instrumentSelection[group.id]}
                    onChange={event => changeInstrument(group.id, event.target.value as InstrumentId)}>
                    {INSTRUMENTS.map(instrument => <option key={instrument.id} value={instrument.id}>{instrument.label}</option>)}
                  </select>
                  <button type="button" title="Tải tiếng và nghe thử nốt C4 bằng SoundFont" onClick={() => void warmInstrument(instrumentSelection[group.id])}>↻</button>
                </div>
              </div>
            );
          })}
          <div className="side-bottom"><strong>ĐẦU RA</strong><div className="bar-dummy"/><p>{summary}</p></div>
        </aside>
        <section className={"editor" + (reviewArea === "roll" ? " ui-review-highlight" : "")}>
          <div className="workarea">
            <div className="keyboard" ref={keyColumn}>
              <div className="ruler-key-label">THỜI GIAN</div>
              {pitches.map(pitch => <button key={pitch} type="button" onClick={() => void previewNote(pitch)} title={'Nghe nốt ' + noteName(pitch)} className={'key ' + ([1,3,6,8,10].includes(pitch%12) ? 'black' : 'white')}>{pitch % 12 === 0 ? noteName(pitch) : ''}</button>)}
            </div>
            <div className="scroller" ref={timelineViewport} onDragOver={event => event.preventDefault()} onDrop={onDropFile} onScroll={event => { if (keyColumn.current) keyColumn.current.scrollTop = event.currentTarget.scrollTop; }}>
              <div className="timeline" style={{ width: timelineWidth }}>
                <div className="ruler">
                  {markers.map(n => <button type="button" key={n} className="tick" style={{ left: n/totalSeconds*100 + '%' }} onClick={() => seekTo(n)}>{n}s</button>)}
                </div>
                <div className={'roll piano-editable' + (phase === 'analyzing' ? ' editing-disabled' : '')}
                  style={{ height: gridHeight }} onPointerDown={addNoteAtPointer}
                  role="group" aria-label="Piano Roll: nhấn lưới để thêm nốt, kéo nốt để di chuyển">
                  {pitches.map(pitch => <div className={'pitch-grid ' + (pitch%12 === 0 ? 'octave' : '')} key={pitch} style={{top:(pitchTop-pitch)*PITCH_ROW,height:PITCH_ROW}}/>)}
                  {markers.map(n => <div key={n} className="beat-grid" style={{left: n/totalSeconds*100 + '%'}}/>)}
                  {visibleIndexedNotes.map(({note:n,index}) => (
                    <button type="button" className={'note editable-note' + (selectedNote === index ? ' selected-note' : '')}
                      key={index} aria-label={'Nốt ' + noteName(n.pitchMidi) + ', bắt đầu ' + fmt(n.startTimeSeconds)}
                      aria-pressed={selectedNote === index}
                      title={noteName(n.pitchMidi) + ' · ' + fmt(n.startTimeSeconds) + ' · ' + n.durationSeconds.toFixed(2) + 's · Kéo để chuyển nốt, kéo mép phải để đổi độ dài'}
                      onPointerDown={event => beginNoteGesture(event, index,
                        event.target instanceof HTMLElement && event.target.closest('.note-resize-handle') ? 'resize' : 'move')}
                      onPointerMove={moveNoteGesture}
                      onPointerUp={event => endNoteGesture(event)}
                      onPointerCancel={event => endNoteGesture(event, true)}
                      style={{
                        top:(pitchTop-n.pitchMidi)*PITCH_ROW + 1,
                        left:n.startTimeSeconds/totalSeconds*100 + '%',
                        width:Math.max(6,n.durationSeconds/totalSeconds*timelineWidth-1),
                        backgroundColor: n.program === undefined ? midiColor(n.pitchMidi) : nativeTrackColor(n.program),
                        borderColor: n.program === undefined ? midiColor(n.pitchMidi) : nativeTrackColor(n.program),
                      }}>
                      {n.durationSeconds/totalSeconds*timelineWidth > 39 ? noteName(n.pitchMidi) : ''}
                      <span className="note-resize-handle" aria-hidden="true"/>
                    </button>
                  ))}
                  {!notes.length && <div className="empty-roll">{phase === 'analyzing' ? <><LoaderCircle className="spin" size={26}/><strong>AI đang nhận diện nốt...</strong></> : <><Music size={27}/><strong>Piano Roll đang trống</strong><small>Nhấn vào lưới để thêm nốt, hoặc tải âm thanh để nhận diện bằng AI</small></>}</div>}
                </div>
                {info && <div className="playhead" style={{left:cursorX,height:28+gridHeight}}/>}
              </div>
            </div>
          </div>
          <div className="editor-status">
            <span>{status}</span>
            <span className="notiq-ai-mode" title={engineMode === 'muscriptor'
              ? 'MuScriptor C++ native: tách nhạc cụ theo GM · CPU-only' : 'Basic Pitch: nhận diện nốt, chưa nhận diện loại nhạc cụ'}>
              AI: {engineMode === 'muscriptor' ? 'MuScriptor CPU' : 'Basic Pitch'}
            </span>
            <span title={soundfontStatus}>{loadingSoundfont ? '◌ Đang tải SoundFont' : '♪ ' + soundfontStatus}</span>
            <span className="piano-edit-hint" title="Thêm nốt: nhấn vào lưới · Di chuyển: kéo nốt · Đổi độ dài: kéo mép phải · Xóa: Del · Hoàn tác: Ctrl+Z">✎ Sửa MIDI · Snap ${SNAP_SECONDS}s · Ctrl+Z</span>
            {phase === 'analyzing' && <div className="progress-track"><div style={{width: progress+'%'}}/></div>}
            <span>{phase === 'analyzing' ? progress+'%' : summary}</span>
            <span className="compact-clock">{fmt(time)} / {fmt(info?.duration || 0)}</span>
            <div className="zoom-controls"><button onClick={()=>setZoom(Math.max(0.5,zoom/1.25))} title="Thu nhỏ"><ZoomOut size={15}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(Math.min(4,zoom*1.25))} title="Phóng to"><ZoomIn size={15}/></button></div>
          </div>
          {error && <div className="error-banner" role="alert"><Info size={15}/>{error}<button aria-label="Đóng lỗi" onClick={()=>setError('')}><X size={15}/></button></div>}
        </section>
      </div>
      <footer className="app-footer"><span><Headphones size={13}/> Piano/Guitar/Bass… từ mẫu FluidR3 SoundFont · xử lý bằng Web Audio</span><span><CircleHelp size={13}/> FluidR3_GM samples: <a href="https://gleitz.github.io/midi-js-soundfonts/" target="_blank" rel="noreferrer">CC BY 3.0 · Frank Wen</a> · Basic Pitch không phân loại nhạc cụ</span></footer>
      <input ref={fileInput} type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff,audio/*" className="hidden" onChange={e => {if(e.target.files?.[0])void setAudio(e.target.files[0],e.target.files[0].name);e.target.value='';}}/>
    </main>
  );
}
export default App;
