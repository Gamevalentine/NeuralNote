
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AudioWaveform, CircleHelp, Gauge, Headphones, Info, LoaderCircle,
  Music, Pause, Play, Square, FolderOpen, RotateCw, Settings2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { fmt, generateDemo, groupFor, GROUPS, noteName, readAudio } from './audio';
import { assertSupportedSong, MAX_SONG_BYTES, MAX_SONG_SECONDS } from './longAudio';
import { createDawMidi, createDawBundle, extractDawTracks, midiChannelLimitExceeded } from './dawMidi';
import { addPedalPoint } from './pedal.ts';
import type { PedalEvent } from './pedal.ts';
import { addNote, copyNotes, removeNote, sameNotes, SNAP_SECONDS, snapSeconds, updateNote, clamp } from './pianoEdit';
import type { Note, AudioInfo, PitchGroup } from './audio';
import { DEFAULT_INSTRUMENTS, INSTRUMENTS, instrumentProgram, playSoundfontNote, prepareInstrument, stopSoundfontNotes } from './soundfont';
import type { InstrumentId, InstrumentSelection } from './soundfont';
import { nativeInstrumentPrograms, nativeProgramName } from './muscriptorProtocol';
import { nativeBridgeAvailable, runMuScriptor } from './muscriptorNative';
import {type Comparison} from './compareEngines';
import {compareOriginalAudio} from './dualEngineNative';
import {ComparisonPanel} from './ComparisonPanel';
import {ComparisonOverlay} from './ComparisonOverlay';
import { runPianoV2 } from './transkunNative';
import { webAiEnabled, installWebModel, recognizeWeb, closeWebModel } from './muscriptorWebLocal';

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
  // Stage 3 opt-in browser preview uses the actual pinned MuScriptor C++ WASM worker.
  const [engineMode, setEngineMode] = useState<'preview' | 'muscriptor'>('preview');
  const [nativeReady, setNativeReady] = useState(false);
  const [analysisEngine, setAnalysisEngine] = useState<'muscriptor'|'transkun-v2'>('muscriptor');
  const [pianoInstalled, setPianoInstalled] = useState(false);
  const [pianoInstalling, setPianoInstalling] = useState(false);
  const [comparison, setComparison] = useState<Comparison|null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparisonBaseline, setComparisonBaseline] = useState<{notes:Note[];pedalEvents:PedalEvent[]}|null>(null);
  const browserAi = webAiEnabled();
  const aiAvailable = nativeReady || browserAi;
  const [nativeModelInstalled, setNativeModelInstalled] = useState(false);
  const [nativeModelSize, setNativeModelSize] = useState<'small' | 'large'>('small');
  const [modelSwitching, setModelSwitching] = useState(false);
  const selectedModelLabel = nativeModelSize === 'large' ? 'Large 2,74 GB' : 'Small 209 MB';
  const [nativeDownloading, setNativeDownloading] = useState(false);
  const [nativeMuted, setNativeMuted] = useState<Set<number>>(new Set());
  const [nativeSolo, setNativeSolo] = useState<number | null>(null);
  const [nativeSelectedProgram, setNativeSelectedProgram] = useState<number | null>(null);
  const [nativeGain, setNativeGain] = useState<Record<number, number>>({});
  const [, setProgress] = useState(0);
  const [recognitionStage, setRecognitionStage] = useState<'preparing' | 'processing'>('preparing');
  const [recognitionElapsed, setRecognitionElapsed] = useState(0);
  const [status, setStatus] = useState('Chưa tải tệp âm thanh');
  const [error, setError] = useState('');
  const [busyLoading, setBusyLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(120);
  const [pedalEvents, setPedalEvents] = useState<PedalEvent[]>([]);
  const [pedalTrack, setPedalTrack] = useState('*');
  // Transcribed notes are the default listening target; the original recording
  // is available explicitly from the playback selector.
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('midi');
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
  const playbackRequestRef = useRef(0);
  const recognitionStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== 'analyzing') return;
    setRecognitionElapsed(0);
    const updateClock = () => setRecognitionElapsed(Math.max(0,
      Math.floor((Date.now() - (recognitionStartedAt.current ?? Date.now())) / 1000)));
    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => {
    if (!nativeBridgeAvailable()) {
      if (browserAi) setEngineMode('muscriptor');
      return;
    }
    let mounted = true;
    void window.notiqNative!.status().then(native => {
      if (!mounted || !native.available) return;
      setNativeReady(true);
      setNativeModelInstalled(native.modelInstalled);
      setNativeModelSize(native.modelSize === 'large' ? 'large' : 'small');
      setEngineMode('muscriptor');
      if(window.notiqNative?.pianoStatus)
        void window.notiqNative.pianoStatus().then(p=>{
          if(mounted)setPianoInstalled(p.installed);
        }).catch(()=>{});
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  useEffect(() => () => {
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    if (audioCtx.current) {
      stopSoundfontNotes(audioCtx.current);
      void audioCtx.current.close().catch(() => undefined);
    }
    closeWebModel();
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
  const usesMidiClock = !info || playbackMode === 'midi';
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
    playbackRequestRef.current++;
    if (audioCtx.current) stopSoundfontNotes(audioCtx.current);
    midiOnlyStart.current = null;
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    selectionRef.current = null;
    setSelection(null);
    setError('');
    setPlaying(false);
    clearHistory();
    setInfo(null);
    setTime(0);
    setPedalEvents([]);
    setPedalTrack('*');
    setComparison(null);
    setCompareOpen(false);
    setComparisonBaseline(null);
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
      if (!aiAvailable) {
        setStatus('Đã tải bài hát · Bản Web chưa bật NOTIQ AI Core');
        setError('Bản Web này đang ở chế độ xem giao diện. Chưa có engine MuScriptor để nhận diện.');
      } else if (nativeReady && analysisEngine === 'transkun-v2') {
        setStatus(pianoInstalled
          ? 'Bài Piano đã mở · Nhấn Nhận diện nốt để chạy Transkun V2 CPU'
          : 'Bài Piano đã mở · Hãy bấm Cài AI Piano Transkun V2 trước.');
        if (!pianoInstalled) setError('Transkun V2 chưa được cài. Dùng nút Cài AI Piano trên NOTIQ Windows.');
      } else if (!nativeModelInstalled) {
        setStatus('Đã tải bài hát · Chờ mô hình MuScriptor từ NeuralNote');
        setError('Chưa có mô hình MuScriptor ' + (nativeReady ? selectedModelLabel : 'Small 209 MB') +
          ' (CC BY-NC 4.0). Hãy bấm Tải mô hình AI.');
      } else if (nativeReady && nativeModelSize === 'large') {
        // Large is CPU-only in this portable build and can be very slow.
        // Never start multi-hour inference just because the user opened a file.
        setStatus('Đã mở bài hát · Large 2,74 GB sẵn sàng. Nhấn Nhận diện nốt để chạy.');
      } else {
        setStatus('Đã tải bài hát · Đang chạy MuScriptor nguyên gốc từ NeuralNote…');
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
    if (nativeDownloading) return;
    if (browserAi && !nativeReady) {
      setNativeDownloading(true);
      setError('');
      setProgress(0);
      try {
        await installWebModel(({percent,message}) => {setStatus(message);setProgress(percent);});
        setNativeModelInstalled(true);
        setStatus('MuScriptor Small đã nạp thành công trên Web · không dùng máy chủ AI');
        if (selectionRef.current) void runRecognition(selectionRef.current,'muscriptor',true);
      } catch(cause) {
        setError(cause instanceof Error ? cause.message : 'Không tải được MuScriptor Small.');
        setStatus('Chưa nạp được MuScriptor AI Core');
      } finally { setNativeDownloading(false); }
      return;
    }
    if (!nativeReady || !window.notiqNative) return;
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
      if (result.modelSize === 'large' || result.modelSize === 'small') setNativeModelSize(result.modelSize);
      setStatus(result.modelInstalled ? 'MuScriptor ' + selectedModelLabel + ' đã tải xong và được kiểm SHA-256. Nhấn Nhận diện nốt.'
        : 'Model MuScriptor chưa hoàn tất');
      // Large never automatically transcribes after a multi-GB download.
      if (result.modelInstalled && nativeModelSize === 'small' && selectionRef.current && engineMode === 'muscriptor')
        void runRecognition(selectionRef.current, 'muscriptor', true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được mô hình MuScriptor');
    } finally {
      detach();
      setNativeDownloading(false);
    }
  };

  const chooseNativeModel = async (size: 'small' | 'large') => {
    if (!nativeReady || !window.notiqNative?.selectModel || phase === 'analyzing' ||
        nativeDownloading || modelSwitching || busyLoading) return;
    if (size === nativeModelSize) return;
    setModelSwitching(true);
    setError('');
    try {
      const selected = await window.notiqNative.selectModel(size);
      setNativeModelSize(selected.modelSize === 'large' ? 'large' : 'small');
      setNativeModelInstalled(selected.modelInstalled);
      const name = size === 'large' ? 'Large 2,74 GB' : 'Small 209 MB';
      setStatus('Đã chọn MuScriptor ' + name +
        (selected.modelInstalled ? '. Nhấn Nhận diện nốt để chạy lại bằng model mới.'
          : '. Nhấn Tải mô hình để tải checkpoint chính thức.'));
      // Previously recognized MIDI remains untouched for A/B comparison.
      // Explicit re-run is required after changing checkpoint.
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Không đổi được mô hình AI.');
    } finally { setModelSwitching(false); }
  };

  const installPianoV2 = async () => {
    if (!nativeReady || !window.notiqNative?.installPiano || pianoInstalling ||
        nativeDownloading || phase === 'analyzing') return;
    setPianoInstalling(true);
    setError('');
    const detach = window.notiqNative.onProgress(({kind,message}) => {
      if (kind === 'setup') setStatus(message);
    });
    try {
      setStatus('Cài Transkun V2 Python/PyTorch trên ổ chứa NOTIQ…');
      const result=await window.notiqNative.installPiano();
      const ready=Boolean(result?.ready);
      setPianoInstalled(ready);
      setStatus(ready ? 'Đã cài Transkun V2. Chọn engine Piano và nhấn Nhận diện nốt.'
        : 'Chưa cài Transkun V2 thành công.');
    } catch(cause) {
      setError('Cài AI Piano thất bại: ' +
        (cause instanceof Error ? cause.message : 'Không xác định. Kiểm tra kết nối và dung lượng ổ ứng dụng.'));
    } finally {
      detach();
      setPianoInstalling(false);
    }
  };

  const runRecognition = async (
    target: Selection, _mode: 'muscriptor' = 'muscriptor', modelJustInstalled = false,
  ) => {
    if (recognitionInFlight.current) return;
    if (!aiAvailable) {
      setStatus('MuScriptor AI Core chưa được bật trên bản Web này');
      setError('Bản Web hiện tại không được cấp engine nhận diện.');
      return;
    }
    if (analysisEngine === 'transkun-v2' && (!nativeReady || !pianoInstalled)) {
      setPhase('ready');
      setError('Transkun V2 Piano chưa được cài trong NOTIQ Windows. Nhấn Cài AI Piano.');
      return;
    }
    if (analysisEngine === 'muscriptor' && !nativeModelInstalled && !modelJustInstalled) {
      setPhase('ready');
      setStatus('Chưa có mô hình MuScriptor · Cần tải AI để nhận diện');
      setError('Hãy tải/nạp mô hình MuScriptor ' + (nativeReady ? selectedModelLabel : 'Small 209 MB') + ' trước khi nhận diện.');
      return;
    }
    recognitionInFlight.current = true;
    playbackRequestRef.current++;
    if (audioCtx.current) stopSoundfontNotes(audioCtx.current);
    midiOnlyStart.current = null;
    recognitionStartedAt.current = Date.now();
    setRecognitionStage('preparing');
    if (audioEl.current) audioEl.current.pause();
    setPlaying(false);
    setPhase('analyzing');
    setError('');
    setProgress(0);
    setStatus(analysisEngine === 'transkun-v2'
      ? 'Transkun V2 đang nhận diện Piano bằng CPU…'
      : 'MuScriptor C++ (' + (nativeReady ? selectedModelLabel : 'Small Web') + ') đang nhận diện bài hát…');
    try {
      const update = ({kind, percent, message}: {kind: 'download' | 'transcribe' | 'setup'; percent: number; message: string}) => {
        if (kind === 'transcribe') {
          setStatus(message);
          setProgress(percent);
          // Neither the pinned MuScriptor WASM worker nor the native bridge
          // guarantees per-note % updates during blocking inference. Do not
          // present the preparation percentage as total AI progress.
          if (/MuScriptor.*(?:đang|nhận diện|xử lý)|nhận diện nốt thật|đang gửi âm thanh|đang xử lý/i.test(message) ||
              percent >= 15) setRecognitionStage('processing');
        }
      };
      const piano = analysisEngine === 'transkun-v2'
        ? await runPianoV2(target.file, update) : null;
      const detected = piano ? piano.notes : nativeReady
        ? await runMuScriptor(target.file, update)
        : await recognizeWeb(target.file, update);
      // All replacement occurs only after the selected engine returns validated
      // output. Failed V2 never deletes the existing MuScriptor MIDI.
      clearHistory(detected);
      setPedalEvents(piano?.pedalEvents || []);
      // Display Piano CC64 points on its GM Piano track immediately; the
      // existing '*' filter only shows user-created global pedal points.
      setPedalTrack(piano ? 'gm-0' : '*');
      setNativeMuted(new Set());
      setNativeSolo(null);
      setNativeSelectedProgram(detected.find(n => n.program !== undefined)?.program ?? null);
      setProgress(100);
      setPhase('complete');
      setStatus(piano
        ? 'Transkun V2 Piano: ' + detected.length + ' nốt · ' +
          piano.pedalEvents.length + ' sự kiện CC64 (nếu có trong kết quả)'
        : 'MuScriptor ' + (nativeReady ? selectedModelLabel : 'Small Web') + ': ' +
          detected.length + ' nốt · ' + nativeInstrumentPrograms(detected).length + ' nhạc cụ' +
          ((!nativeReady && import.meta.env.VITE_NOTIQ_EXPRESSIVE_VELOCITY === '1')
           ? ' · Velocity ước lượng từ audio' : ''));
      firedNotes.current.clear();
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error ? cause.message : 'Engine nhận diện thất bại');
      setStatus('Không thể nhận diện bài hát · có thể thử lại bằng nút Nhận diện');
    } finally {
      recognitionInFlight.current = false;
    }
  };

  const runComparison = async () => {
    const source=selectionRef.current;
    if (!source || !nativeReady || !nativeModelInstalled || !pianoInstalled ||
        recognitionInFlight.current || phase==='analyzing' || busyLoading) {
      setError('5H cần NOTIQ Windows và hai engine đã cài đầy đủ.');
      return;
    }
    recognitionInFlight.current=true;
    const beforePhase=phase;
    const beforeNotes=copyNotes(notesRef.current);
    const beforePedal=pedalEvents.map(p=>({...p}));
    stop();
    recognitionStartedAt.current=Date.now();
    setRecognitionStage('preparing');
    setPhase('analyzing');
    setError('');
    try {
      const result=await compareOriginalAudio(source.file,message=>{
        setStatus('5H: '+message);
        setRecognitionStage('processing');
      });
      setComparison(result);
      setComparisonBaseline({notes:beforeNotes,pedalEvents:beforePedal});
      setCompareOpen(true);
      setStatus('5H: '+result.pairs.length+' nốt chung · '+
        result.muscriptorOnly.length+' chỉ MuScriptor · '+
        result.transkunOnly.length+' chỉ Transkun. MIDI không bị thay.');
    } catch (cause) {
      setError('5H: '+(cause instanceof Error?cause.message:'So sánh thất bại')+
        '. MIDI đang chỉnh vẫn được giữ.');
    } finally {
      recognitionInFlight.current=false;
      setPhase(beforePhase==='error'?(notesRef.current.length?'complete':'ready'):beforePhase);
    }
  };

  const useComparedResult = (engine:'muscriptor'|'transkun-v2'|'original') => {
    if(!comparison||phase==='analyzing')return;
    const chosen=engine==='original'?comparisonBaseline:
      engine==='muscriptor'?comparison.muscriptor:comparison.transkun;
    if(!chosen)return;
    stop();
    commitNotes(copyNotes(chosen.notes));
    setPedalEvents(chosen.pedalEvents.map(p=>({...p})));
    setPedalTrack(chosen.pedalEvents.find(p=>p.trackKey!=='*')?.trackKey || (engine==='transkun-v2'?'gm-0':'*'));
    setNativeMuted(new Set());
    setNativeSolo(null);
    setNativeSelectedProgram(chosen.notes[0]?.program??null);
    setPhase('complete');
    setStatus(engine==='original'?'Đã khôi phục bản MIDI trước 5H.':
      'Đã chọn MIDI '+(engine==='muscriptor'?'MuScriptor':'Transkun V2')+
      '; hai kết quả vẫn lưu trong bảng 5H.');
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
      // MIDI is timed by AudioContext, even if an original song was uploaded.
      // A paused/stalled HTML <audio> must never freeze MIDI playback.
      const ctx = audioCtx.current;
      const now = usesMidiClock
        ? Math.max(0, (ctx?.currentTime || 0) - (midiOnlyStart.current ?? (ctx?.currentTime || 0)))
        : (audioEl.current?.currentTime || 0);
      if (usesMidiClock) {
        setTime(Math.min(totalSeconds, now));
        if (now >= totalSeconds) {
          if (loop && ctx) {
            midiOnlyStart.current = ctx.currentTime;
            setTime(0);
            previousTime.current = 0;
            firedNotes.current.clear();
            stopSoundfontNotes(ctx);
          } else {
            setPlaying(false);
            midiOnlyStart.current = null;
            if (ctx) stopSoundfontNotes(ctx);
          }
          return;
        }
      }
      const before = previousTime.current;
      const timeJump = now < before - 0.10 || now > before + 0.65;
      if (timeJump) firedNotes.current.clear();
      // Scan crossed onsets rather than require the browser to hit a 155ms
      // sampling window exactly; otherwise 4-minute songs silently miss notes.
      const from = timeJump ? Math.max(0, now - 0.12) : Math.max(0, before - 0.075);
      previousTime.current = now;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const group = groupFor(n.pitchMidi);
        if (!isNoteAudible(n) || firedNotes.current.has(i)) continue;
        if (n.startTimeSeconds >= from && n.startTimeSeconds <= now + 0.060) {
          firedNotes.current.add(i);
          const level = n.program === undefined ? gain[group] : (nativeGain[n.program] ?? 0.7);
          // Preserve baseline loudness at MuScriptor's default 100/127;
          // use estimated expressive velocity only where opt-in analysis supplied it.
          const velocityGain = Math.max(0.3, Math.min(1.15,
            (Number.isFinite(n.amplitude) ? n.amplitude : 0.7874015748) / 0.7874015748));
          // The previous 0.85s cap cut off long held notes during MIDI preview.
          // SoundFont player's existing safe maximum is 8 seconds.
          void previewNote(n.pitchMidi, Math.min(8, n.durationSeconds),
            Math.min(1, level * masterVolume * velocityGain), n.program);
        }
      }
    }, 45);
    return () => window.clearInterval(interval);
  }, [playing, notes, playbackMode, activeGroups, gain, masterVolume, info, usesMidiClock, totalSeconds, loop, instrumentSelection, nativeGain, nativeMuted, nativeSolo]);

  useEffect(() => {
    if (audioEl.current) audioEl.current.volume = playbackMode === 'midi' ? 0 : masterVolume * (playbackMode === 'mix' ? 0.65 : 1);
  }, [playbackMode, masterVolume, selection]);

  const togglePlayback = async () => {
    const audio = audioEl.current;
    if (phase === 'analyzing' || busyLoading || loadingSoundfont || (!info && !visibleNotes.length)) return;
    const request = ++playbackRequestRef.current;
    if (playing) {
      audio?.pause();
      // Native HTML media events are not authoritative in MIDI-only mode.
      if (audioCtx.current) stopSoundfontNotes(audioCtx.current);
      midiOnlyStart.current = null; // preserve the paused time in state
      setPlaying(false);
      return;
    }
    try {
      const ctx = getAudioContext();
      if (ctx.state !== 'running') await ctx.resume();
      if (request !== playbackRequestRef.current) return;
      if (playbackMode !== 'original' || !info) {
        const needed = [...new Set(visibleNotes.filter(n => n.program !== 128).map(n => n.program === undefined ? instrumentSelection[groupFor(n.pitchMidi)] : nativeSoundfontPreset(n.program)))];
        if (needed.length) {
          setLoadingSoundfont(true);
          setSoundfontStatus('Đang chuẩn bị các tiếng SoundFont để phát MIDI...');
          await Promise.all(needed.map(instrument => prepareInstrument(ctx, instrument)));
          if (request !== playbackRequestRef.current) return;
          setSoundfontStatus('Đã tải xong ' + needed.length + ' bộ tiếng SoundFont');
        }
      }
      firedNotes.current.clear();
      previousTime.current = usesMidiClock ? time : (audio?.currentTime || time);
      if (!usesMidiClock && audio) {
        await audio.play();
        if (request !== playbackRequestRef.current) { audio.pause(); return; }
        if (audio.paused) throw new Error('Trình duyệt chưa phát được âm thanh gốc.');
      } else {
        if (!visibleNotes.length) throw new Error('Không có nốt MIDI để phát. Hãy nhận diện hoặc thêm nốt.');
        audio?.pause();
        midiOnlyStart.current = ctx.currentTime - time;
      }
      if (request === playbackRequestRef.current) setPlaying(true);
    } catch (cause) {
      if (request === playbackRequestRef.current) {
        setSoundfontStatus('Lỗi SoundFont / phát lại');
        setError('Không thể chuẩn bị bộ tiếng: ' + (cause instanceof Error ? cause.message : 'Kiểm tra mạng hoặc thử chọn lại nhạc cụ.'));
      }
    } finally {
      setLoadingSoundfont(false);
    }
  };
  const seekTo = (seconds: number) => {
    if (audioCtx.current) stopSoundfontNotes(audioCtx.current);
    const clamped = Math.max(0, Math.min(info?.duration || totalSeconds, seconds));
    if (usesMidiClock) {
      if (midiOnlyStart.current !== null && audioCtx.current)
        midiOnlyStart.current = audioCtx.current.currentTime - clamped;
    } else if (info && audioEl.current) {
      audioEl.current.currentTime = clamped;
    }
    setTime(clamped);
    previousTime.current = clamped;
    firedNotes.current.clear();
  };
  const stop = () => {
    playbackRequestRef.current++;
    if (audioEl.current) audioEl.current.pause();
    if (audioCtx.current) stopSoundfontNotes(audioCtx.current);
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

  const pedalTracks = extractDawTracks(notes,
    { high: instrumentProgram(instrumentSelection.high),
      mid: instrumentProgram(instrumentSelection.mid),
      low: instrumentProgram(instrumentSelection.low) },
    new Set<PitchGroup>(['high', 'mid', 'low'])).filter(track => !track.isDrum);
  const writePedalPoint = (value: 0 | 127) => {
    if (!notes.length || phase === 'analyzing') return;
    const at = Math.max(0, Math.min(info?.duration || totalSeconds, time));
    setPedalEvents(previous => addPedalPoint(previous, {
      trackKey: pedalTrack, timeSeconds: at, value,
    }));
    setStatus((value === 127 ? 'Đạp' : 'Nhả') + ' pedal CC64 ở ' + fmt(at) + ' · Chỉ ghi vào MIDI khi xuất.');
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
      downloadResult(createDawBundle(tracks, bpm, pedalEvents), basename + '_DAW_KONTAKT.zip', 'application/zip');
      setStatus('Đã xuất ' + tracks.length + ' track MIDI riêng + hướng dẫn Kontakt');
    } else {
      downloadResult(createDawMidi(tracks, bpm, pedalEvents), basename + '_MULTITRACK.mid', 'audio/midi');
      setStatus('Đã xuất MIDI Type 1: ' + tracks.length + ' track');
    }
    if (midiChannelLimitExceeded(tracks))
      setError('Vượt 15 nhạc cụ giai điệu trên 1 cổng GM. Dùng gói ZIP MIDI riêng từng track để tránh trùng kênh trong DAW.');
  };
  const reset = () => {
    stop();
    setComparison(null);
    setCompareOpen(false);
    setComparisonBaseline(null);
    setComparison(null);
    setCompareOpen(false);
    setComparisonBaseline(null);
    setSelection(null);
    setInfo(null);
    clearHistory();
    setTime(0);
    setPedalEvents([]);
    setPedalTrack('*');
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
        { label: 'Xóa kết quả nhận diện', run: () => { commitNotes([]); setPedalEvents([]); setSelectedNote(null); setPhase(selection ? 'ready' : 'empty'); setStatus('Đã xóa kết quả MIDI'); }, disabled: notes.length === 0 || phase === 'analyzing' },
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
        { label:'5H · So sánh MuScriptor và Transkun',run:()=>void runComparison(),
          disabled:!nativeReady||!selection||!nativeModelInstalled||!pianoInstalled||phase==='analyzing' },
        { label:'5H · Xem đối chiếu',run:()=>setCompareOpen(true),disabled:!comparison },
        { label: nativeReady ? 'AI: MuScriptor (NeuralNote gốc) — đang sử dụng'
            : 'MuScriptor gốc NeuralNote — yêu cầu NOTIQ Windows',
          run: () => {}, disabled: true, checked: nativeReady },
        ...(nativeReady ? [{
          label: nativeModelInstalled ? 'MuScriptor ' + selectedModelLabel + ' — đã tải' :
            nativeDownloading ? 'Đang tải mô hình MuScriptor…' : 'Tải mô hình MuScriptor ' + selectedModelLabel,
          run: () => void downloadNativeModel(), disabled: nativeDownloading || modelSwitching || nativeModelInstalled,
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
        onTimeUpdate={event => { if (!usesMidiClock) setTime(event.currentTarget.currentTime); }}
        onPause={() => { if (!usesMidiClock) setPlaying(false); }}
        onPlay={() => { if (!usesMidiClock) setPlaying(true); }}
        onError={event => {
          // Surface real codec/HTML audio failures instead of an apparent
          // running transport with a frozen 00:00 counter.
          if (playbackMode !== 'midi')
            setError('Không phát được tệp âm thanh gốc trong trình duyệt này (lỗi media ' +
              (event.currentTarget.error?.code ?? '?') + '). Hãy chọn Chỉ MIDI.');
        }}
        onEnded={() => {
          if (usesMidiClock) return;
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
                      <select id="playmode-menu" value={playbackMode} onChange={event => { stop(); setPlaybackMode(event.target.value as PlaybackMode); }}>
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
                      <small>{nativeReady ? 'Engine: NeuralNote MuScriptor C++' : 'Web chỉ xem giao diện · AI cần Windows'}</small>
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
          {phase === 'analyzing' && <div className="ai-running-indicator" role="status"
            aria-label="NOTIQ AI đang phân tích" title={status}>
            <LoaderCircle size={14} className="spin"/>
            <span>{recognitionStage === 'preparing' ? 'Đang chuẩn bị âm thanh' : 'AI đang nhận diện nốt'}</span>
          </div>}
          {aiAvailable && (phase === 'ready' || phase === 'error') && selection && <button type="button"
            className="ai-retry-button" disabled={busyLoading || nativeDownloading}
            title="Chạy AI nhận diện âm thanh thành các nốt MIDI"
            onClick={startInference}>Nhận diện nốt</button>}
          {nativeReady && <label className="notiq-model-choice">
            <span>Engine</span>
            <select aria-label="Engine nhận diện" value={analysisEngine}
              disabled={phase === 'analyzing' || pianoInstalling || nativeDownloading}
              onChange={event => {
                const next=event.target.value as 'muscriptor'|'transkun-v2';
                setAnalysisEngine(next);
                setStatus(next==='transkun-v2'
                  ? 'Đã chọn Transkun V2 (Piano). Nốt hiện tại được giữ cho đến khi nhận diện lại.'
                  : 'Đã chọn MuScriptor (đa nhạc cụ). Nốt hiện tại được giữ nguyên.');
                setError('');
              }}>
              <option value="muscriptor">MuScriptor · Đa nhạc cụ</option>
              <option value="transkun-v2">Transkun V2 · Piano</option>
            </select>
          </label>}
          {nativeReady && analysisEngine==='transkun-v2' && !pianoInstalled &&
            <button type="button" className="ai-retry-button"
              disabled={pianoInstalling || nativeDownloading || phase === 'analyzing'}
              onClick={()=>void installPianoV2()}>
              {pianoInstalling ? 'Đang cài Piano…' : 'Cài AI Piano'}
            </button>}
          {nativeReady && analysisEngine==='muscriptor' && <label className="notiq-model-choice">
            <span>Model AI</span>
            <select aria-label="Chọn mô hình AI" value={nativeModelSize}
              disabled={modelSwitching || nativeDownloading || phase === 'analyzing' || busyLoading}
              onChange={event => void chooseNativeModel(event.target.value as 'small' | 'large')}>
              <option value="small">Small · 209 MB</option>
              <option value="large">Large · 2,74 GB</option>
            </select>
          </label>}
          {aiAvailable && analysisEngine === 'muscriptor' && engineMode === 'muscriptor' && !nativeModelInstalled &&
            <button type="button" className="ai-retry-button" disabled={nativeDownloading || modelSwitching}
              title={'Tải mô hình MuScriptor ' + (nativeReady ? selectedModelLabel : 'Small 209 MB') + ' chính thức'}
              onClick={() => void downloadNativeModel()}>
              {nativeDownloading ? 'Đang tải mô hình…' : 'Tải mô hình AI'}
            </button>}
          <span className="lunor">LUNOR <b>MUSIC</b></span>
          <a href="https://github.com/Gamevalentine/NeuralNote" target="_blank" rel="noreferrer">Mã nguồn ↗</a>
          {desktopReview && <button type="button" className="desktop-review-toggle" aria-expanded={showDesktopReview} onClick={() => { setActiveMenu(null); setShowSettings(false); setShowDesktopReview(value => !value); }}><Info size={14}/> Duyệt Desktop <span>UI v0.3</span></button>}
          <button type="button" className="os-settings" onClick={() => { setActiveMenu(null); setShowSettings(!showSettings); }} title="Cài đặt" aria-label="Cài đặt"><Settings2 size={16} /></button>
        </div>
      </header>
      <div className="notiq-transport" role="group" aria-label="Điều khiển phát lại">
        <button type="button" className="notiq-transport-open" aria-label="Mở bài hát"
          disabled={busyLoading || phase === 'analyzing'}
          onClick={() => fileInput.current?.click()}><FolderOpen size={15}/> <span>Mở bài</span></button>
        <button type="button" className="notiq-transport-play"
          aria-label={playing ? 'Tạm dừng' : 'Phát'}
          disabled={(!info && !visibleNotes.length) || phase === 'analyzing' || busyLoading || loadingSoundfont}
          onClick={() => void togglePlayback()}>
          {playing ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}
          <span>{playing ? 'Tạm dừng' : 'Phát'}</span>
        </button>
        <button type="button" aria-label="Dừng" disabled={!info && !notes.length}
          onClick={stop}><Square size={14} fill="currentColor"/> <span>Dừng</span></button>
        <button type="button" className={loop ? 'is-active' : ''}
          aria-label="Phát lặp" aria-pressed={loop} onClick={() => setLoop(value => !value)}
          title="Bật hoặc tắt phát lặp"><RotateCw size={15}/><span>Lặp</span></button>
        <label className="notiq-transport-mode" htmlFor="notiq-playback-mode">
          <span>Nghe</span>
          <select id="notiq-playback-mode" aria-label="Chế độ nghe" value={playbackMode}
            onChange={event => { stop(); setPlaybackMode(event.target.value as PlaybackMode); }}>
            <option value="midi">Chỉ MIDI</option>
            <option value="original" disabled={!info}>Âm gốc</option>
            <option value="mix" disabled={!info}>Cả hai</option>
          </select>
        </label>
        <div className="notiq-transport-clock" aria-label="Thời gian phát">
          {fmt(time)} <span>/</span> {fmt(info?.duration || (notes.length ? totalSeconds : 0))}
        </div>
        {selection && <button type="button" className="notiq-transport-close" aria-label="Đóng bài hát"
          disabled={phase === 'analyzing' || busyLoading} onClick={reset}>
          <X size={14}/><span>Đóng bài</span></button>}
      </div>
      {nativeReady && selection && <section className="notiq-5h-controls" aria-label="So sánh AI Piano">
        <strong>AI 5H</strong>
        <button type="button" aria-label="So sánh hai AI" onClick={()=>void runComparison()}
          disabled={phase==='analyzing'||busyLoading||pianoInstalling||nativeDownloading||
                    !pianoInstalled||!nativeModelInstalled}>
          So sánh MuScriptor ↔ Transkun V2
        </button>
        {comparison&&<button type="button" onClick={()=>setCompareOpen(v=>!v)}
          aria-expanded={compareOpen}>{compareOpen?'Ẩn đối chiếu':'Xem đối chiếu'}</button>}
        {!pianoInstalled&&<small>Cần cài Transkun V2 Piano</small>}
        {!nativeModelInstalled&&<small>Cần tải mô hình MuScriptor</small>}
        <span>Chạy 2 AI trên cùng âm thanh · Giữ nguyên MIDI đang chỉnh</span>
      </section>}
      {comparison&&compareOpen&&nativeReady&&<ComparisonPanel result={comparison}
        onUse={useComparedResult} onSeek={seekTo} onClose={()=>setCompareOpen(false)}
        disabled={phase==='analyzing'} canRestore={!!comparisonBaseline}/>}
      {desktopReview && showDesktopReview && <section className="desktop-review-panel" aria-label="Duyệt giao diện NOTIQ Desktop">
        <div className="desktop-review-head"><strong>NOTIQ Desktop · Bản duyệt giao diện</strong><button type="button" aria-label="Đóng bảng duyệt" onClick={() => { setShowDesktopReview(false); setReviewArea(null); }}><X size={16}/></button></div>
        <p>Trang này là bản mẫu giao diện. Piano Roll, SoundFont và xuất MIDI hoạt động; việc tự động nhận diện nốt dùng engine MuScriptor gốc NeuralNote trên Windows.</p>
        <strong className="desktop-review-subtitle">Chọn vùng muốn kiểm tra</strong>
        <div className="desktop-review-areas">
          {([
            ['menu', 'Thanh menu'],
            ['tracks', 'Nhóm nốt'],
            ['roll', 'Piano Roll'],
          ] as const).map(([id, label]) => <button key={id} type="button" className={reviewArea === id ? 'selected' : ''} aria-pressed={reviewArea === id} onClick={() => setReviewArea(current => current === id ? null : id)}>{label}</button>)}
        </div>
        <p className="desktop-review-note">Đây chỉ là bản Web duyệt giao diện. Nhận diện đa nhạc cụ dùng engine MuScriptor C++ gốc NeuralNote trong ứng dụng Windows; không chạy bằng WebGL/Basic Pitch ở đây.</p>
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
        <p>{nativeReady ? 'Bản Windows: MuScriptor đa nhạc cụ hoặc Transkun V2 Piano CPU; Large cần RAM và thời gian xử lý đáng kể.' :
          browserAi ? 'Web Preview chỉ hỗ trợ MuScriptor Small 209 MB trong WASM; Large 2,74 GB không khả thi với bộ WASM hiện tại.'
          : 'Bản Web chưa kết nối AI MuScriptor.'} Model chính thức, CC BY-NC 4.0 (phi thương mại). Không có checkpoint MuScriptor 4 GB được xác minh.</p>
        {nativeReady && <label>Chọn model nhận diện
          <select aria-label="Model nhận diện chất lượng" value={nativeModelSize}
            disabled={modelSwitching || nativeDownloading || phase === 'analyzing' || busyLoading}
            onChange={event => void chooseNativeModel(event.target.value as 'small' | 'large')}>
            <option value="small">Small · 209 MB (nhanh hơn)</option>
            <option value="large">Large · 2,74 GB (thử nghiệm chất lượng cao, CPU rất chậm)</option>
          </select>
        </label>}
        {nativeReady && <p>Engine thử nghiệm: <strong>{analysisEngine==='transkun-v2'?'Transkun V2 · Piano':'MuScriptor · đa nhạc cụ'}</strong>.
          {analysisEngine==='transkun-v2' && (pianoInstalled ? ' AI Piano đã sẵn sàng.'
            : ' Cài đặt PyTorch/Transkun sẽ tải từ nguồn chính thức và lưu cạnh NOTIQ trên ổ đã chọn.')}
          {analysisEngine==='transkun-v2' && !pianoInstalled &&
            <button type="button" disabled={pianoInstalling} onClick={()=>void installPianoV2()}>
              {pianoInstalling?'Đang cài AI Piano…':'Cài Transkun V2 tự động'}
            </button>}</p>}
        {aiAvailable && analysisEngine==='muscriptor' && <p><strong>MuScriptor {nativeReady ? selectedModelLabel : 'Small 209 MB'}: {nativeModelInstalled ? 'đã sẵn sàng' : 'chưa tải'}</strong>
          {!nativeModelInstalled && <button type="button" disabled={nativeDownloading || modelSwitching}
            onClick={() => void downloadNativeModel()}>{nativeDownloading ? 'Đang tải model…' :
              'Tải mô hình ' + (nativeReady ? selectedModelLabel : 'Small · 209 MB')}</button>}</p>}
      </div>}
      <div className="studio">
        <aside className={"sidebar" + (reviewArea === "tracks" ? " ui-review-highlight" : "")}>
          <div className="sidebar-heading">
            <span>{hasNativeTracks ? 'TRACK NHẠC CỤ AI' : 'NHÓM NỐT / DẢI ÂM'}</span>
            <span>{hasNativeTracks ? nativePrograms.length : (notes.length ? GROUPS.length : 0)}</span>
          </div>
          <div className="track-explainer">{hasNativeTracks
            ? 'MuScriptor (NeuralNote) · mỗi track là một nhạc cụ GM'
            : 'Piano Roll · chỉnh sửa nốt MIDI bằng tay trên Web'}</div>
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
          {phase === 'analyzing' && <div className="notiq-ai-overlay">
            <section className="notiq-ai-card" role="status" aria-live="polite" aria-label="Tiến trình nhận diện nốt">
              <div className="notiq-ai-card-heading"><LoaderCircle size={21} className="spin"/><strong>NOTIQ đang nhận diện âm thanh</strong></div>
              <p className="notiq-ai-filename" title={selection?.name}>{selection?.name || 'Bài nhạc đã chọn'}</p>
              <div className="notiq-ai-stages">
                <span className="completed">1. {recognitionStage === 'preparing' ? 'Chuẩn bị âm thanh' : 'Đã chuẩn bị âm thanh'}</span>
                <span className={recognitionStage === 'processing' ? 'current' : ''}>2. Nhận diện nốt MIDI</span>
              </div>
              <div className="notiq-ai-indeterminate" role="progressbar"
                aria-label="AI đang xử lý, chưa có phần trăm suy luận chính xác"><div/></div>
              <p className="notiq-ai-stage-message">{status}</p>
              <div className="notiq-ai-card-footer"><span>Đã chạy: {fmt(recognitionElapsed)}</span><span>{recognitionStage === 'preparing' ? 'Giai đoạn 1/2' : 'Giai đoạn 2/2'}</span></div>
              <small>AI gốc chưa cung cấp % nhận diện chính xác; thanh chuyển động chỉ báo đang xử lý, không phải thời gian còn lại.</small>
            </section>
          </div>}
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
                  {comparison&&compareOpen&&<ComparisonOverlay result={comparison}
                    pitchTop={pitchTop} rowHeight={PITCH_ROW}
                    width={timelineWidth} seconds={totalSeconds}/>}
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
                <div className="pedal-lane" role="group" aria-label="Các điểm pedal CC64 đã đặt">
                  <span className="pedal-lane-caption">CC64</span>
                  {pedalEvents.map((event, index) => (
                    (pedalTrack === '*' ? event.trackKey === '*' : (event.trackKey === '*' || event.trackKey === pedalTrack)) &&
                    <button key={event.trackKey + '-' + event.timeSeconds + '-' + index} type="button"
                      className={'pedal-marker ' + (event.value === 127 ? 'pedal-on' : 'pedal-off')}
                      style={{left:(event.timeSeconds / totalSeconds * 100) + '%'}}
                      title={(event.value === 127 ? 'Đạp' : 'Nhả') + ' pedal · ' + fmt(event.timeSeconds) + ' · ' + (event.trackKey === '*' ? 'Mọi track giai điệu' : event.trackKey) + ' · Nhấn để xóa điểm'}
                      aria-label={(event.value === 127 ? 'Xóa điểm đạp' : 'Xóa điểm nhả') + ' pedal lúc ' + fmt(event.timeSeconds)}
                      onClick={() => setPedalEvents(previous => previous.filter(point => point !== event))}
                    >{event.value === 127 ? '▼' : '▲'}</button>
                  ))}
                </div>
                {info && <div className="playhead" style={{left:cursorX,height:28+gridHeight}}/>}
              </div>
            </div>
          </div>
          <div className="pedal-toolbar" role="group" aria-label="Biên tập pedal MIDI CC64">
            <strong>Pedal · CC64</strong>
            <select aria-label="Track nhận pedal" value={pedalTrack}
              onChange={event => setPedalTrack(event.target.value)}>
              <option value="*">Mọi track giai điệu</option>
              {pedalTracks.map(track => <option value={track.key} key={track.key}>{track.name}</option>)}
            </select>
            <button type="button" disabled={!notes.length || phase === 'analyzing'}
              onClick={() => writePedalPoint(127)}>Đạp tại {fmt(time)}</button>
            <button type="button" disabled={!notes.length || phase === 'analyzing'}
              onClick={() => writePedalPoint(0)}>Nhả tại {fmt(time)}</button>
            <button type="button" disabled={!pedalEvents.length || phase === 'analyzing'}
              onClick={() => setPedalEvents([])}>Xóa pedal</button>
            <small>{pedalEvents.length} điểm · Đặt vị trí bằng thước thời gian. CC64 chỉ có trong MIDI xuất, chưa mô phỏng bằng SoundFont.</small>
          </div>
          <div className="editor-status">
            <span>{status}</span>
            <span className="notiq-ai-mode" title={nativeReady ? 'MuScriptor C++ native trên Windows' : browserAi ? 'MuScriptor C++ WebAssembly thật chạy tại trình duyệt' : 'Bản Web chưa bật AI'}>
              {nativeReady ? 'AI: MuScriptor (Windows)' : browserAi ? 'AI: NOTIQ Core (WebAssembly)' : 'Web UI Preview · chưa bật AI'}
            </span>
            <span title={soundfontStatus}>{loadingSoundfont ? '◌ Đang tải SoundFont' : '♪ ' + soundfontStatus}</span>
            <span className="piano-edit-hint" title="Thêm nốt: nhấn vào lưới · Di chuyển: kéo nốt · Đổi độ dài: kéo mép phải · Xóa: Del · Hoàn tác: Ctrl+Z">✎ Sửa MIDI · Snap ${SNAP_SECONDS}s · Ctrl+Z</span>
            {phase === 'analyzing' && <span className="recognition-status-short">{recognitionStage === 'preparing' ? 'Chuẩn bị âm thanh' : 'Đang phân tích nốt'}</span>}
            <span>{phase === 'analyzing' ? 'Đã chạy '+fmt(recognitionElapsed) : summary}</span>
            <span className="compact-clock">{fmt(time)} / {fmt(info?.duration || 0)}</span>
            <div className="zoom-controls"><button onClick={()=>setZoom(Math.max(0.5,zoom/1.25))} title="Thu nhỏ"><ZoomOut size={15}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(Math.min(4,zoom*1.25))} title="Phóng to"><ZoomIn size={15}/></button></div>
          </div>
          {error && <div className="error-banner" role="alert"><Info size={15}/>{error}<button aria-label="Đóng lỗi" onClick={()=>setError('')}><X size={15}/></button></div>}
        </section>
      </div>
      <footer className="app-footer"><span><Headphones size={13}/> Piano/Guitar/Bass… từ mẫu FluidR3 SoundFont · xử lý bằng Web Audio</span><span><CircleHelp size={13}/> Nhận diện: MuScriptor gốc NeuralNote trên Windows · <a href="https://gleitz.github.io/midi-js-soundfonts/" target="_blank" rel="noreferrer">FluidR3_GM CC BY 3.0</a></span></footer>
      <input ref={fileInput} type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff,audio/*" className="hidden" onChange={e => {if(e.target.files?.[0])void setAudio(e.target.files[0],e.target.files[0].name);e.target.value='';}}/>
    </main>
  );
}
export default App;
