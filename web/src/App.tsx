
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AudioWaveform, CircleHelp, Gauge, Headphones, Info, LoaderCircle,
  Music, Pause, Play, Square, FolderOpen, RotateCw, Settings2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { fmt, generateDemo, groupFor, GROUPS, noteName, readAudio } from './audio';
import { assertSupportedSong, MAX_SONG_BYTES, MAX_SONG_SECONDS } from './longAudio';
import { createDawMidi, createDawBundle, extractDawTracks, midiChannelLimitExceeded } from './dawMidi';
import { addPedalPoint, addPedalSpan, shiftPedalPoint, pedalDownAt } from './pedal.ts';
import type { PedalEvent } from './pedal.ts';
import { addNote, copyNotes, removeNote, sameNotes, SNAP_SECONDS, snapSeconds, updateNote, nudgeNoteBoundary, clamp } from './pianoEdit';
import type { Note, AudioInfo, PitchGroup } from './audio';
import { DEFAULT_INSTRUMENTS, INSTRUMENTS, instrumentProgram, playSoundfontNote, prepareInstrument, stopSoundfontNotes } from './soundfont';
import type { InstrumentId, InstrumentSelection } from './soundfont';
import { nativeInstrumentPrograms, nativeProgramName } from './muscriptorProtocol';
import { nativeBridgeAvailable, runMuScriptor, convertAudioToNativeWav } from './muscriptorNative';
import {NativeBenchmarkPanel} from './NativeBenchmarkPanel';
import {Stage5MDAcceptance} from './Stage5MDAcceptance';
import type {BenchmarkResult} from './nativeBenchmark';
import {type Comparison} from './compareEngines';
import {compareOriginalAudio} from './dualEngineNative';
import {ComparisonPanel} from './ComparisonPanel';
import {ComparisonOverlay} from './ComparisonOverlay';
import {BenchmarkPanel} from './BenchmarkPanel';
import {WebBenchmarkPanel} from './WebBenchmarkPanel';
import {previewOverlapCleanup} from './noteQuality';
import {previewNearExactDuplicates,diagnoseAgainstReference,cleanupPreservesReference} from './noteQuality5NB';
import {estimateVelocityFromAudio} from './velocityFromAudio';
import {midiVelocity,setNoteVelocity,nudgeNoteVelocity,notePreviewVolume} from './velocityEditor';
import {soundingDurationWithPedal} from './pedalPlayback';
import {readReferenceMidi,benchmarkComparison,scoreAgainstReference,type MidiReference,type MusicMode} from './referenceBenchmark';
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
  const [musicMode, setMusicMode] = useState<MusicMode>('ensemble');
  const [referenceMidi, setReferenceMidi] = useState<MidiReference|null>(null);
  const [webCandidateMidi,setWebCandidateMidi]=useState<MidiReference|null>(null);
  const [referenceOffset, setReferenceOffset] = useState(0);
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [comparisonBaseline, setComparisonBaseline] = useState<{notes:Note[];pedalEvents:PedalEvent[]}|null>(null);
  const benchmark = useMemo(()=>{
    if(!referenceMidi||!comparison||!showScores)return null;
    try{return benchmarkComparison(comparison,referenceMidi,musicMode,referenceOffset)}
    catch{return null}
  },[referenceMidi,comparison,musicMode,referenceOffset,showScores]);
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
  const [nativeReportedPercent, setNativeReportedPercent] = useState<number | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [benchOpen,setBenchOpen]=useState(false);
  const [acceptanceOpen,setAcceptanceOpen]=useState(false);
  const [benchRunning,setBenchRunning]=useState(false);
  const [benchSeconds,setBenchSeconds]=useState<20|30|60>(20);
  const [benchOffset,setBenchOffset]=useState(0);
  const [benchStatus,setBenchStatus]=useState('Chưa đo');
  const [benchPercent,setBenchPercent]=useState<number|null>(null);
  const [benchResult,setBenchResult]=useState<BenchmarkResult|null>(null);
  const [benchTrials,setBenchTrials]=useState<BenchmarkResult[]>([]);
  const [benchThreads,setBenchThreads]=useState<2|4|6>(2);
  const [appliedCpuThreads,setAppliedCpuThreads]=useState<2|4|6>(2);
  const [nativeThreadsSupported,setNativeThreadsSupported]=useState(false);
  const [supportsResumableChunks,setSupportsResumableChunks]=useState(false);
  const [useResumeChunks,setUseResumeChunks]=useState(false);
  const [status, setStatus] = useState('Chưa tải tệp âm thanh');
  const [error, setError] = useState('');
  const [busyLoading, setBusyLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [bpm, setBpm] = useState(120);
  const [pedalEvents, setPedalEvents] = useState<PedalEvent[]>([]);
  const pedalEventsRef = useRef<PedalEvent[]>([]);
  useEffect(()=>{pedalEventsRef.current=pedalEvents},[pedalEvents]);
  const pedalUndoRef=useRef<PedalEvent[][]>([]);
  const pedalRedoRef=useRef<PedalEvent[][]>([]);
  const [,setPedalHistoryTick]=useState(0);
  const [selectedPedalIndex,setSelectedPedalIndex]=useState<number|null>(null);
  const [pedalSpanSeconds,setPedalSpanSeconds]=useState<0.5|1|2>(1);
  useEffect(()=>{
    // Pedal edit history belongs to one loaded song. Do not undo into old audio.
    pedalUndoRef.current=[];pedalRedoRef.current=[];
    setSelectedPedalIndex(null);setPedalHistoryTick(t=>t+1);
  },[selection]);
  const [rawRecognitionNotes, setRawRecognitionNotes] = useState<Note[]|null>(null);
  const [velocityBusy, setVelocityBusy] = useState(false);
  // 5N-C slider is a draft, so dragging produces only one Undo step when applied.
  const [velocityDraft,setVelocityDraft] = useState<number|null>(null);
  const [velocityBefore,setVelocityBefore] = useState<{
    index:number;key:string;velocity:number
  }|null>(null);
  useEffect(()=>{setVelocityDraft(null);setVelocityBefore(null)},[selectedNote,selection]);
  const [showNoteReview, setShowNoteReview] = useState(false);
  const noteCleanup=useMemo(()=>previewOverlapCleanup(notes),[notes]);
  const overlapBenchmark=useMemo(()=>{
    if(!referenceMidi || !noteCleanup.merged || !notes.length)return null;
    const isPiano=musicMode==='piano' || (musicMode==='guided' &&
      referenceMidi.notes.every(n=>n.program>=0&&n.program<8));
    const ref=isPiano?referenceMidi.notes.filter(n=>n.program>=0&&n.program<8):referenceMidi.notes;
    if(!ref.length)return null;
    const byMode=(array:Note[])=>isPiano
      ?array.filter(n=>n.program===undefined||n.program>=0&&n.program<8):array;
    try{
      const before=scoreAgainstReference(ref,byMode(notes),referenceOffset);
      const after=scoreAgainstReference(ref,byMode(noteCleanup.notes),referenceOffset);
      return {before,after,change:Math.round((after.f1-before.f1)*10000)/100};
    }catch{return null}
  },[referenceMidi,noteCleanup,notes,musicMode,referenceOffset]);

  const duplicateReview=useMemo(()=>previewNearExactDuplicates(notes),[notes]);
  const qualityReferenceScope=useMemo(()=>{
    if(!referenceMidi)return null;
    const piano=musicMode==='piano'||(musicMode==='guided'&&
      referenceMidi.notes.every(n=>n.program>=0&&n.program<8));
    return {reference:piano?referenceMidi.notes.filter(n=>n.program>=0&&n.program<8):referenceMidi.notes,
      selected:(array:Note[])=>piano?array.filter(n=>n.program===undefined||n.program>=0&&n.program<8):array};
  },[referenceMidi,musicMode]);
  const qualityDuplicateScores=useMemo(()=>{
    if(!qualityReferenceScope||!qualityReferenceScope.reference.length||!duplicateReview.removed)return null;
    try{
      const before=scoreAgainstReference(qualityReferenceScope.reference,
        qualityReferenceScope.selected(notes),referenceOffset);
      const after=scoreAgainstReference(qualityReferenceScope.reference,
        qualityReferenceScope.selected(duplicateReview.notes),referenceOffset);
      return{before,after,safe:cleanupPreservesReference(before,after)};
    }catch{return null}
  },[qualityReferenceScope,notes,duplicateReview,referenceOffset]);
  const noteDiagnostics=useMemo(()=>{
    if(!showNoteReview||!qualityReferenceScope||!qualityReferenceScope.reference.length)return null;
    try{return diagnoseAgainstReference(qualityReferenceScope.reference,
      qualityReferenceScope.selected(notes),referenceOffset)}
    catch{return null}
  },[showNoteReview,qualityReferenceScope,notes,referenceOffset]);

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
      setNativeThreadsSupported(native.nativeThreadsSupported===true);
      setSupportsResumableChunks(native.supportsResumableChunks===true);
      if([2,4,6].includes(native.selectedCpuThreads??-1))
        setAppliedCpuThreads(native.selectedCpuThreads as 2|4|6);
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
  const selectedVelocityNote=selectedNote===null?null:notes[selectedNote]??null;
  const selectedVelocityKey=selectedVelocityNote?
    [selectedVelocityNote.pitchMidi,selectedVelocityNote.program??'none',
     selectedVelocityNote.startTimeSeconds,selectedVelocityNote.durationSeconds].join('|'):'';
  const originalVelocity=(velocityBefore && velocityBefore.index===selectedNote &&
      velocityBefore.key===selectedVelocityKey) ?
    velocityBefore.velocity:(selectedVelocityNote?midiVelocity(selectedVelocityNote):100);
  const editingVelocity=selectedVelocityNote?
    velocityDraft??midiVelocity(selectedVelocityNote):100;
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
    if (phase === 'analyzing' || recognitionInFlight.current || benchRunning || busyLoading) return;
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
    setRawRecognitionNotes(null);
    setBenchResult(null);
    setBenchTrials([]);
    setBenchPercent(null);
    setBenchOffset(0);
    setBenchStatus('Chưa đo');
    setPedalTrack('*');
    setComparison(null);
    setCompareOpen(false);
    setComparisonBaseline(null);
    setReferenceMidi(null);
    setWebCandidateMidi(null);
    setReferenceOffset(0);
    setShowScores(false);
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
    if (!nativeReady || !window.notiqNative?.selectModel || phase === 'analyzing' || benchRunning ||
        nativeDownloading || modelSwitching || busyLoading) return;
    if (size === nativeModelSize) return;
    setModelSwitching(true);
    setError('');
    try {
      const selected = await window.notiqNative.selectModel(size);
      setNativeModelSize(selected.modelSize === 'large' ? 'large' : 'small');
      setNativeModelInstalled(selected.modelInstalled);
      setBenchResult(null);setBenchTrials([]);
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
    if (!nativeReady || !window.notiqNative?.installPiano || benchRunning || pianoInstalling ||
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
    if (nativeReady && analysisEngine === 'transkun-v2' && !pianoInstalled) {
      setPhase('ready');
      setError('Transkun V2 Piano chưa được cài trong NOTIQ Windows. Nhấn Cài AI Piano.');
      return;
    }
    if (!nativeModelInstalled && !modelJustInstalled) {
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
    setNativeReportedPercent(null);
    setCancelPending(false);
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
      const update = ({kind, percent, message}: {kind: 'download' | 'transcribe' | 'setup' | 'benchmark' | 'checkpoint'; percent: number; message: string}) => {
        if(kind==='checkpoint'){
          setStatus(message);
        }
        if (kind === 'transcribe') {
          setStatus(message);
          setProgress(percent);
          if (nativeReady && analysisEngine === 'muscriptor' &&
              message.includes('từ engine') && Number.isFinite(percent)) {
            setNativeReportedPercent(percent);
          }
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
        ? await runMuScriptor(target.file, update, useResumeChunks && supportsResumableChunks)
        : await recognizeWeb(target.file, update);
      // All replacement occurs only after the selected engine returns validated
      // output. Failed V2 never deletes the existing MuScriptor MIDI.
      setRawRecognitionNotes(copyNotes(detected));
      clearHistory(detected);
      setPedalEvents(piano?.pedalEvents || []);
      pedalUndoRef.current=[];pedalRedoRef.current=[];setSelectedPedalIndex(null);setPedalHistoryTick(t=>t+1);
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
      setPhase(notesRef.current.length ? 'complete' : 'error');
      setError(cause instanceof Error ? cause.message : 'Engine nhận diện thất bại');
      setStatus('Không thể nhận diện bài hát · có thể thử lại bằng nút Nhận diện');
    } finally {
      recognitionInFlight.current = false;
    }
  };

  const resetResumeCheckpoint=async()=>{
    if(!nativeReady||!supportsResumableChunks||!selectionRef.current||
       phase==='analyzing'||benchRunning||busyLoading||!window.notiqNative?.clearCheckpoint)return;
    setError('');
    try{
      setStatus('Đang chuẩn hóa bài nhạc để xác định chính xác checkpoint cần xóa…');
      const wav=await convertAudioToNativeWav(selectionRef.current.file);
      const result=await window.notiqNative.clearCheckpoint(wav);
      setStatus(result.cleared
        ?'Đã xóa tiến độ 5M-C lưu cho bài/model/luồng CPU này. Lần sau sẽ nhận diện từ đầu.'
        :'Chưa có tiến độ 5M-C lưu cho bài/model/luồng CPU này.');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Không thể xóa checkpoint đã lưu.');
    }
  };
  const startNativeBenchmark=async()=>{
    const current=selectionRef.current;
    const bridge=window.notiqNative;
    if(!nativeReady||!bridge?.benchmark||!current||!nativeModelInstalled||
       benchRunning||recognitionInFlight.current||phase==='analyzing'||busyLoading)return;
    if((info?.duration??0)<benchSeconds ||
       benchOffset+benchSeconds>(info?.duration??0)){
      setError('Bài nhạc không đủ dài cho đoạn benchmark. Hãy chọn 20 giây hoặc giảm vị trí bắt đầu.');
      return;
    }
    recognitionInFlight.current=true;
    stop(); // prevent SoundFont playback from contaminating CPU benchmark measurements
    setBenchRunning(true);
    setBenchResult(null);
    setBenchPercent(null);
    setError('');
    const detach=bridge.onProgress(({kind,percent,message})=>{
      if(kind!=='benchmark')return;
      setBenchStatus(message);
      if(message.includes('từ CLI')&&Number.isFinite(percent))setBenchPercent(percent);
    });
    try{
      setBenchStatus('Đang chuẩn hóa bài hát thành WAV Float32 mono 16 kHz…');
      const start=performance.now();
      const wav=await convertAudioToNativeWav(current.file,percent=>
        setBenchStatus('Đang chuẩn bị PCM: '+percent+'%'));
      const audioPrepareMs=Math.round(performance.now()-start);
      setBenchStatus('Đang đo '+benchThreads+' luồng CPU trên đoạn '+benchSeconds+' giây, model '+selectedModelLabel+'…');
      const result=await bridge.benchmark({
        wav,seconds:benchSeconds,startSeconds:benchOffset,audioPrepareMs,threads:benchThreads
      });
      setBenchResult(result);
      // Keep independent repetitions (5M-D acceptance needs >=2 per thread).
      // Limit in-memory history to avoid unbounded growth; never discard earlier
      // samples just because they share a clip and CPU-thread count.
      setBenchTrials(prev=>[...prev,result].slice(-36));
      setBenchStatus('Đo hoàn tất và đã lưu số liệu ở '+result.savedRelativePath);
      setStatus('5M-A hoàn tất benchmark '+benchSeconds+' giây — nốt MIDI đang chỉnh không thay đổi.');
    }catch(cause){
      const message=cause instanceof Error?cause.message:'Không thể đo hiệu năng.';
      setBenchStatus('Benchmark không hoàn tất: '+message);
      setError(message);
    }finally{
      detach();
      recognitionInFlight.current=false;
      setBenchRunning(false);
    }
  };
  const applyBenchCpuThreads=async(threads:2|4|6)=>{
    if(!nativeReady||!nativeThreadsSupported||benchRunning||
       recognitionInFlight.current||!window.notiqNative?.applyCpuThreads)return;
    if(!benchTrials.some(x=>x.threadCount===threads&&x.model===nativeModelSize)){
      setError('Cần đo thử thành công mức '+threads+' luồng trên model này trước khi áp dụng.');
      return;
    }
    try{
      const status=await window.notiqNative.applyCpuThreads(threads);
      setAppliedCpuThreads(status.selectedCpuThreads as 2|4|6);
      setStatus('Đã áp dụng '+threads+' luồng CPU cho lần nhận diện tiếp theo; MIDI hiện tại vẫn giữ nguyên.');
      setError('');
    }catch(cause){setError(cause instanceof Error?cause.message:'Không thể đổi số luồng CPU.')}
  };
  const cancelNativeBenchmark=async()=>{
    try{
      const result=await window.notiqNative?.cancelTranscription?.();
      setBenchStatus(result?.requested?'Đã gửi yêu cầu dừng MuScriptor; đang dọn file tạm…':
        'Chưa thể hủy ở bước chuẩn bị âm thanh; không có tiến trình AI đang chạy.');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Không dừng được benchmark.');
    }
  };

  const cancelNativeRecognition = async () => {
    if (!nativeReady || !window.notiqNative?.cancelTranscription || cancelPending) return;
    try {
      const response = await window.notiqNative.cancelTranscription();
      if (response.requested) {
        setCancelPending(true);
        setStatus('Đang dừng tiến trình MuScriptor, giữ nguyên MIDI đã chỉnh…');
      } else {
        setStatus(response.reason || 'MuScriptor đang chuẩn bị âm thanh, chưa khởi chạy AI.');
      }
    } catch (cause) {
      setError('Không thể dừng MuScriptor: ' +
        (cause instanceof Error ? cause.message : 'Lỗi không xác định'));
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

  const loadReference = async(file:File) => {
    if(phase==='analyzing'||busyLoading)return;
    setError('');
    try {
      const parsed=await readReferenceMidi(file,file.name);
      setReferenceMidi(parsed);
      setShowScores(false);
      setShowBenchmark(true);
      setStatus('Đã tải MIDI chuẩn '+file.name+' · '+parsed.notes.length+
        ' nốt. Chọn So sánh hai AI rồi chấm F1.');
    } catch(cause){
      setReferenceMidi(null);
      setShowScores(false);
      setError('Không đọc được MIDI chuẩn: '+
        (cause instanceof Error?cause.message:'Tệp không hợp lệ'));
    }
  };
  const chooseMusicMode = (mode:MusicMode) => {
    if(phase==='analyzing')return;
    setMusicMode(mode);
    if(mode==='piano')setAnalysisEngine('transkun-v2');
    if(mode==='ensemble')setAnalysisEngine('muscriptor');
    setShowScores(false);
    setStatus(mode==='piano'?'5I: chế độ Piano ưu tiên Transkun V2, dùng MuScriptor khi đối chiếu.' :
      mode==='ensemble'?'5I: chế độ đa nhạc cụ dùng MuScriptor.' :
      '5I: tự đề xuất chỉ dựa trên F1 của MIDI tham chiếu, không tự thay MIDI.');
  };
  const evaluateReference = () => {
    if(!referenceMidi)return;
    if(comparison){
      try {
        benchmarkComparison(comparison,referenceMidi,musicMode,referenceOffset);
        setShowScores(true);
        setStatus('5I: kết quả điểm F1 so với MIDI chuẩn đã hiển thị.');
      }catch(cause){setError(cause instanceof Error?cause.message:'Không chấm được MIDI chuẩn.')}
    }else{
      setShowScores(true);
      void runComparison();
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
      pedalUndoRef.current=[];pedalRedoRef.current=[];setSelectedPedalIndex(null);setPedalHistoryTick(t=>t+1);
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
          // 5N-C: full 1..127 note velocity dynamic range, not the old 0.3/1.15
          // clipping that flattened soft/strong notes. MuScriptor 100 remains 1x.
          // SoundFont gain is a preview, not physical piano key-force or timbre.
          void previewNote(n.pitchMidi, soundingDurationWithPedal(n,pedalEvents),
            Math.min(1, notePreviewVolume(n,level,masterVolume)), n.program);
        }
      }
    }, 45);
    return () => window.clearInterval(interval);
  }, [playing, notes, playbackMode, activeGroups, gain, masterVolume, info, usesMidiClock, totalSeconds, loop, instrumentSelection, nativeGain, nativeMuted, nativeSolo, pedalEvents]);

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
  const applyOverlapCleanup = () => {
    if(phase==='analyzing'||!notesRef.current.length)return;
    const updated=previewOverlapCleanup(notesRef.current);
    if(!updated.merged){setStatus('Không có nốt chồng cùng cao độ/track; bản MIDI không thay đổi.');return}
    if(qualityReferenceScope?.reference.length){
      try{
        const before=scoreAgainstReference(qualityReferenceScope.reference,
          qualityReferenceScope.selected(notesRef.current),referenceOffset);
        const after=scoreAgainstReference(qualityReferenceScope.reference,
          qualityReferenceScope.selected(updated.notes),referenceOffset);
        if(!cleanupPreservesReference(before,after)){
          setError('5N-B: từ chối gộp nốt chồng vì MIDI chuẩn cho thấy chất lượng giảm.');
          return;
        }
      }catch{setError('5N-B: chưa xác minh được F1, giữ nguyên MIDI.');return;}
    }
    commitNotes(updated.notes);
    setStatus('Đã gộp '+updated.merged+' nốt chồng trong '+updated.affectedTracks+
      ' track. Bấm Hoàn tác để khôi phục.');
  };
  const nudgeSelectedNote = (edge:'onset'|'offset',delta:number) => {
    if(phase==='analyzing'||selectedNote===null||!notesRef.current[selectedNote])return;
    const old=notesRef.current;
    const result=nudgeNoteBoundary(old,selectedNote,edge,delta,totalSeconds);
    if(result===old)return;
    commitNotes(result);
    setStatus('5N-B: chỉnh ' + (edge==='onset'?'thời điểm nhấn':'thời điểm nhả') +
      (delta>0?' +10 ms':' −10 ms') + '. Có thể Hoàn tác (Ctrl+Z).');
  };
  const applyStrictDuplicates = () => {
    if(phase==='analyzing'||!notesRef.current.length)return;
    const candidate=previewNearExactDuplicates(notesRef.current);
    if(!candidate.removed){setStatus('Không phát hiện nốt trùng gần như giống hệt.');return;}
    // Fail closed: never accept a cleanup that worsens independently supplied MIDI.
    if(qualityReferenceScope){
      if(!qualityReferenceScope.reference.length){
        setError('Chưa có nốt phù hợp trong MIDI chuẩn để kiểm tra; giữ nguyên MIDI.');return;
      }
      try{
        const before=scoreAgainstReference(qualityReferenceScope.reference,
          qualityReferenceScope.selected(notesRef.current),referenceOffset);
        const after=scoreAgainstReference(qualityReferenceScope.reference,
          qualityReferenceScope.selected(candidate.notes),referenceOffset);
        if(!cleanupPreservesReference(before,after)){
          setError('5N-B: nốt trùng có thể là lần nhấn thật. MIDI chuẩn không cho phép xóa; giữ nguyên MIDI.');
          return;
        }
      }catch{setError('5N-B: không kiểm tra được MIDI chuẩn; giữ nguyên MIDI.');return;}
    }
    commitNotes(candidate.notes);
    setSelectedNote(null);
    setStatus('5N-B: lọc ' + candidate.removed +
      ' nốt gần như trùng tuyệt đối. Cao độ/thời gian nốt còn lại không đổi; có thể Hoàn tác.');
  };
  const commitSelectedVelocity = (target:number) => {
    if(phase==='analyzing'||playing||selectedNote===null||!notesRef.current[selectedNote])
      return;
    const current=notesRef.current[selectedNote];
    const next=setNoteVelocity(notesRef.current,selectedNote,target);
    if(next===notesRef.current){
      setVelocityDraft(null);
      return;
    }
    const key=[current.pitchMidi,current.program??'none',
      current.startTimeSeconds,current.durationSeconds].join('|');
    setVelocityBefore(previous=>
      previous?.index===selectedNote&&previous.key===key
        ? previous:{index:selectedNote,key,velocity:midiVelocity(current)});
    commitNotes(next);
    setVelocityDraft(null);
    setStatus('5N-C: nốt '+noteName(current.pitchMidi)+' velocity '+
      midiVelocity(current)+' → '+midiVelocity(next[selectedNote])+
      '/127. MIDI xuất ghi đúng lực nhấn; Ctrl+Z để hoàn tác.');
  };
  const nudgeSelectedVelocity=(delta:number)=>{
    if(selectedNote===null||!notesRef.current[selectedNote]||
      phase==='analyzing'||playing)return;
    const target=nudgeNoteVelocity(notesRef.current,selectedNote,delta);
    if(target===notesRef.current)return;
    commitSelectedVelocity(midiVelocity(target[selectedNote]));
  };
  const previewSelectedVelocity = (candidate:number) => {
    if(!selectedVelocityNote||playing||phase==='analyzing')return;
    if(audioCtx.current)stopSoundfontNotes(audioCtx.current);
    const sample={...selectedVelocityNote,amplitude:Math.max(1,Math.min(127,candidate))/127};
    const level=sample.program===undefined
      ? gain[groupFor(sample.pitchMidi)]:(nativeGain[sample.program]??0.7);
    void previewNote(sample.pitchMidi,Math.max(0.12,Math.min(0.75,sample.durationSeconds)),
      Math.min(1,notePreviewVolume(sample,level,masterVolume)),sample.program);
  };
  const applyAudioVelocity = async () => {
    const selected = selection, sourceNotes = notesRef.current;
    if (!selected || !sourceNotes.length || phase === 'analyzing'
        || recognitionInFlight.current || velocityBusy) return;
    setVelocityBusy(true);
    let ctx: AudioContext | null = null;
    try {
      // Process locally; original file and MIDI never leave the user's machine.
      ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(await selected.file.arrayBuffer());
      if (selectionRef.current !== selected || notesRef.current !== sourceNotes
          || recognitionInFlight.current) {
        setStatus('Audio hoặc MIDI đã thay đổi; bỏ kết quả ước lượng velocity cũ.');
        return;
      }
      const channels = Array.from({length: Math.min(buffer.numberOfChannels, 2)},
        (_,i) => buffer.getChannelData(i));
      const candidate = estimateVelocityFromAudio(sourceNotes,
        {sampleRate: buffer.sampleRate, channels});
      if (!candidate.changed) {
        setStatus('Âm lượng bản ghi chưa đủ biến thiên hoặc MIDI đã có velocity; giữ nguyên các nốt.');
        return;
      }
      commitNotes(candidate.notes);
      setStatus('5N: đã ước lượng velocity cho ' + candidate.changed +
        ' nốt từ âm lượng bản ghi (không phải lực tay thật). Bấm Hoàn tác để so sánh.');
    } catch (cause) {
      setError('Không đo được velocity từ âm thanh: ' +
        (cause instanceof Error ? cause.message : 'Tệp âm thanh không hợp lệ.'));
    } finally {
      if (ctx) await ctx.close().catch(() => undefined);
      setVelocityBusy(false);
    }
  };
  const restoreRawRecognition = () => {
    if(phase==='analyzing'||!rawRecognitionNotes)return;
    commitNotes(copyNotes(rawRecognitionNotes));
    setStatus('Đã khôi phục nốt nguyên bản do AI nhận diện, chưa qua sửa nốt chồng.');
  };
  const commitPedalEvents=(next:PedalEvent[])=>{
    const previous=pedalEventsRef.current;
    if(next===previous||JSON.stringify(next)===JSON.stringify(previous))return false;
    pedalUndoRef.current=[...pedalUndoRef.current.slice(-49),
      previous.map(e=>({...e}))];
    pedalRedoRef.current=[];
    pedalEventsRef.current=next;
    setPedalEvents(next);
    setPedalHistoryTick(t=>t+1);
    return true;
  };
  const pedalUndo=()=>{
    if(phase==='analyzing'||!pedalUndoRef.current.length)return;
    const old=pedalUndoRef.current.pop()!;
    pedalRedoRef.current.push(pedalEventsRef.current.map(e=>({...e})));
    pedalEventsRef.current=old;
    setPedalEvents(old);
    setSelectedPedalIndex(null);
    setPedalHistoryTick(t=>t+1);
    setStatus('5N-D: đã Hoàn tác chỉnh pedal; MIDI nốt không thay đổi.');
  };
  const pedalRedo=()=>{
    if(phase==='analyzing'||!pedalRedoRef.current.length)return;
    const next=pedalRedoRef.current.pop()!;
    pedalUndoRef.current.push(pedalEventsRef.current.map(e=>({...e})));
    pedalEventsRef.current=next;
    setPedalEvents(next);
    setSelectedPedalIndex(null);
    setPedalHistoryTick(t=>t+1);
    setStatus('5N-D: đã Làm lại chỉnh pedal.');
  };
  const createPedalSpan=()=>{
    if(!notes.length||phase==='analyzing')return;
    const at=Math.max(0,Math.min(totalSeconds,time));
    const to=Math.min(900,at+pedalSpanSeconds);
    const next=addPedalSpan(pedalEventsRef.current,pedalTrack,at,to);
    if(commitPedalEvents(next)){
      setSelectedPedalIndex(null);
      setStatus('5N-D: đã thêm một khoảng đạp–nhả CC64 '+fmt(at)+' → '+fmt(to)+
        '. Xuất MIDI giữ nguyên note-off; SoundFont mô phỏng ngân đến khi nhả.');
    }else setStatus('5N-D: đã có pedal tại vị trí này hoặc khoảng thời gian không hợp lệ.');
  };
  const nudgeSelectedPedal=(delta:number)=>{
    if(phase==='analyzing'||selectedPedalIndex===null)return;
    const old=pedalEventsRef.current;
    const point=old[selectedPedalIndex];
    if(!point)return;
    const next=shiftPedalPoint(old,selectedPedalIndex,delta);
    if(commitPedalEvents(next)){
      const shifted=next.findIndex(e=>e.trackKey===point.trackKey&&
        e.value===point.value&&Math.abs(e.timeSeconds-(point.timeSeconds+delta))<.002);
      setSelectedPedalIndex(shifted>=0?shifted:null);
      setStatus('5N-D: đã dịch điểm CC64 '+(delta>0?'+10':'−10')+
        ' ms; MIDI và SoundFont dùng cùng thời điểm.');
    }else setStatus('Không thể dịch qua một điểm pedal lân cận hoặc ngoài thời gian hợp lệ.');
  };
  const writePedalPoint = (value: 0 | 127) => {
    if (!notes.length || phase === 'analyzing') return;
    const at = Math.max(0, Math.min(info?.duration || totalSeconds, time));
    commitPedalEvents(addPedalPoint(pedalEventsRef.current, {
      trackKey: pedalTrack, timeSeconds: at, value,
    }));
    setSelectedPedalIndex(null);
    setStatus((value === 127 ? 'Đạp' : 'Nhả') + ' CC64 tại ' + fmt(at) + ' · MIDI giữ note-off gốc; SoundFont kéo tiếng khi có nhả pedal.');
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
    setReferenceMidi(null);
    setWebCandidateMidi(null);
    setReferenceOffset(0);
    setShowScores(false);
    setShowBenchmark(false);
    setSelection(null);
    setInfo(null);
    clearHistory();
    setTime(0);
    setPedalEvents([]);
    setRawRecognitionNotes(null);
    setBenchResult(null);
    setBenchTrials([]);
    setBenchPercent(null);
    setBenchOffset(0);
    setBenchStatus('Chưa đo');
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
        { label:'5J · Chấm MIDI trên Web',run:()=>setShowBenchmark(true),disabled:!selection||!browserAi },
        { label: nativeReady ? 'AI: MuScriptor (NeuralNote gốc) — Windows'
            : browserAi ? 'AI: MuScriptor Small · WebAssembly (tại trình duyệt)'
            : 'AI Web chưa bật · bản Windows có MuScriptor',
          run: () => {}, disabled: true, checked: nativeReady || browserAi },
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
                      <small>{nativeReady ? 'Engine: NeuralNote MuScriptor C++' : browserAi ? 'Web: MuScriptor Small WASM thật' : 'Web chưa bật AI'}</small>
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
            disabled={busyLoading || benchRunning || phase === 'analyzing'}
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
              disabled={modelSwitching || nativeDownloading || benchRunning || phase === 'analyzing' || busyLoading}
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
          disabled={phase === 'analyzing' || benchRunning || busyLoading} onClick={reset}>
          <X size={14}/><span>Đóng bài</span></button>}
      </div>
      {nativeReady&&selection&&analysisEngine==='muscriptor'&&<section className="notiq-5mc-options"
         aria-label="5M-C lưu tiến độ nhận diện từng đoạn">
        <strong>AI 5M-C</strong>
        <label>
          <input type="checkbox" checked={useResumeChunks} disabled={!supportsResumableChunks||
            phase==='analyzing'||benchRunning||busyLoading}
            onChange={e=>setUseResumeChunks(e.target.checked)}/>
          Lưu và tiếp tục nhận diện theo đoạn 5 giây (thử nghiệm)
        </label>
        <button type="button" disabled={!supportsResumableChunks||phase==='analyzing'||benchRunning||busyLoading}
          onClick={()=>void resetResumeCheckpoint()}>Xóa tiến độ đã lưu</button>
        <small>{supportsResumableChunks
         ?'Bật trước khi bấm Nhận diện. Engine giữ nốt nối qua đoạn; nếu Dừng, lần nhận diện sau trên đúng bài, model và luồng CPU sẽ tự tiếp tục.'
         :'Binary MuScriptor hiện tại chưa hỗ trợ checkpoint. Hãy dùng bản 5M-C Windows.'}
         {' '}Checkpoint chứa nốt và trạng thái resume, lưu riêng trên ổ ứng dụng; không tự tăng tốc độ giải mã Large.</small>
      </section>}
      {nativeReady&&selection&&<section className="notiq-5m-switch" aria-label="Bộ đo hiệu năng MuScriptor">
        <strong>AI 5M-B</strong>
        <button type="button" aria-label="Mở benchmark CPU" aria-expanded={benchOpen}
          onClick={()=>setBenchOpen(v=>!v)}>{benchOpen?'Ẩn benchmark':'So sánh CPU 2 / 4 / 6 luồng'}</button>
        <small>Model {selectedModelLabel} · nhận diện hiện tại {appliedCpuThreads} luồng · giữ nguyên MIDI</small>
      </section>}
      {nativeReady&&selection&&benchOpen&&<NativeBenchmarkPanel
        running={benchRunning} status={benchStatus} percent={benchPercent}
        seconds={benchSeconds} setSeconds={v=>{setBenchSeconds(v);setBenchOffset(0)}}
        offset={benchOffset} setOffset={setBenchOffset}
        duration={info?.duration??0} model={selectedModelLabel}
        result={benchResult} trials={benchTrials} threads={benchThreads}
        setThreads={setBenchThreads} nativeThreadsSupported={nativeThreadsSupported}
        activeThreads={appliedCpuThreads} onApply={n=>void applyBenchCpuThreads(n)}
        canRun={nativeModelInstalled&&!busyLoading&&!pianoInstalling&&!modelSwitching&&
          !nativeDownloading&&phase!=='analyzing'}
        onRun={()=>void startNativeBenchmark()}
        onCancel={()=>void cancelNativeBenchmark()}
      />}
      {nativeReady&&selection&&<section className="notiq-5md-toggle" aria-label="5M-D kiểm tra nghiệm thu">
        <strong>5M-D · Đánh giá phiên bản</strong>
        <button type="button" aria-expanded={acceptanceOpen}
         onClick={()=>setAcceptanceOpen(v=>!v)}>
         {acceptanceOpen?'Ẩn bảng nghiệm thu':'Mở bảng kiểm tốc độ và MIDI'}
        </button>
        <small>Đánh giá trên máy của bạn · không tự đổi cấu hình hoặc merge bản chính</small>
      </section>}
      {nativeReady&&selection&&acceptanceOpen&&<Stage5MDAcceptance
         key={selection.url+'|'+nativeModelSize+'|'+appliedCpuThreads+'|'+(referenceMidi?.fileName||'none')}
         trials={benchTrials} clipSeconds={benchSeconds} clipOffset={benchOffset}
         model={nativeModelSize} notes={notes} referenceMidi={referenceMidi} sourceAudio={selection.file}
         onImportBenchmarks={reports=>setBenchTrials(prev=>[...prev,...reports].slice(-36))}
         musicMode={musicMode} referenceOffset={referenceOffset}
         songDuration={info?.duration??0} busy={phase==='analyzing'||benchRunning||busyLoading}
       />}
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
      {notes.length>0&&aiAvailable&&<section className="notiq-quality-controls"
        aria-label="Tối ưu nốt và pedal">
        <strong>Chất lượng MIDI</strong>
        <div className="notiq-5nc-velocity" role="group" aria-label="Chỉnh velocity từng nốt MIDI 5N-C">
          <strong>5N-C · Velocity từng nốt</strong>
          {selectedVelocityNote ? <>
            <label htmlFor="notiq-velocity-5nc">
              {noteName(selectedVelocityNote.pitchMidi)} · {editingVelocity}/127
              {velocityDraft!==null?' (chưa áp dụng)':''}
            </label>
            <input type="range" id="notiq-velocity-5nc"
              min={1} max={127} step={1} value={editingVelocity}
              disabled={phase==='analyzing'||playing}
              onChange={event=>setVelocityDraft(Number(event.target.value))}/>
            <button type="button" disabled={phase==='analyzing'||playing}
              onClick={()=>nudgeSelectedVelocity(-5)}>−5</button>
            <button type="button" disabled={phase==='analyzing'||playing}
              onClick={()=>nudgeSelectedVelocity(5)}>+5</button>
            <button type="button" disabled={phase==='analyzing'||playing||
              velocityDraft===null||velocityDraft===midiVelocity(selectedVelocityNote)}
              onClick={()=>commitSelectedVelocity(editingVelocity)}>Áp dụng</button>
            <button type="button" disabled={phase==='analyzing'||playing||
              editingVelocity===originalVelocity}
              onClick={()=>previewSelectedVelocity(originalVelocity)}>Nghe trước</button>
            <button type="button" disabled={phase==='analyzing'||playing}
              onClick={()=>previewSelectedVelocity(editingVelocity)}>Nghe sau</button>
            <small>MIDI 1–127 · bản nháp không sửa nốt cho tới khi Áp dụng.
              Nghe trước/sau cùng nhạc cụ và âm lượng tổng; Ctrl+Z để hoàn tác.
              SoundFont chỉ mô phỏng độ lớn, chưa tái tạo lực gõ/âm sắc piano thật.</small>
          </> : <small>Chọn một nốt trên Piano Roll để chỉnh lực nhấn và nghe so sánh.</small>}
        </div>
        <button type="button" aria-label="Mở kiểm tra nốt MIDI 5N-B"
          aria-expanded={showNoteReview}
          onClick={()=>setShowNoteReview(v=>!v)}>
          {showNoteReview?'Ẩn 5N-B · Kiểm tra nốt':'5N-B · Kiểm tra nốt đúng/sai'}
        </button>
        {showNoteReview&&<div className="notiq-5nb-review" aria-label="Báo cáo nốt MIDI 5N-B">
          <p>Ứng viên trùng gần như tuyệt đối: <b>{duplicateReview.removed}</b>.
            Không tự xóa các lần nhấn lặp, nốt trống hay nốt có pitch-bend.</p>
          {qualityDuplicateScores&&<p>F1 trước/sau lọc theo MIDI chuẩn:
            <b> {(qualityDuplicateScores.before.f1*100).toFixed(2)}% → {(qualityDuplicateScores.after.f1*100).toFixed(2)}%</b>
            {qualityDuplicateScores.safe?' · Không giảm tiêu chí F1/onset/offset.':
              ' · Không đạt: thao tác bị chặn để giữ nốt gốc.'}</p>}
          <div className="notiq-5nb-nudge">
            <strong>Chỉnh chính xác nốt đang chọn {selectedNote===null?'(chọn nốt trên Piano Roll)':
              '('+noteName(notes[selectedNote]?.pitchMidi??60)+')'}</strong>
            {([
              ['Nhấn −10 ms','onset',-.01],['Nhấn +10 ms','onset',.01],
              ['Nhả −10 ms','offset',-.01],['Nhả +10 ms','offset',.01]
            ] as const).map(([label,edge,delta])=>
              <button type="button" key={label}
                disabled={phase==='analyzing'||selectedNote===null||!notes[selectedNote]}
                onClick={()=>nudgeSelectedNote(edge,delta)}>{label}</button>)}
            <small>Thay đổi một nốt, không làm tròn vào lưới 125 ms.
              Thao tác được lưu vào lịch sử Hoàn tác.</small>
          </div>
          <button type="button" disabled={!duplicateReview.removed||phase==='analyzing'||
             (!!qualityReferenceScope&&!qualityDuplicateScores?.safe)}
            onClick={applyStrictDuplicates}>
            Lọc {duplicateReview.removed} ứng viên trùng · Hoàn tác được
          </button>
          {noteDiagnostics?<div role="group" aria-label="Đối chiếu MIDI chuẩn">
            <p><strong>MIDI chuẩn đã nạp:</strong> khớp {noteDiagnostics.matched} nốt,
              thiếu tương ứng {noteDiagnostics.missing}, dư {noteDiagnostics.extra},
              nhả nốt lệch dung sai {noteDiagnostics.offsetWarnings}.</p>
            <small>So khớp cùng cao độ và thời điểm nhấn ±100 ms theo 5I.
              Kết quả chỉ có ý nghĩa khi MIDI chuẩn cùng bản diễn và đã chỉnh offset.
              Không tự chèn nốt thiếu hoặc thay bản gốc.</small>
            {([
              ['Chưa khớp với MIDI chuẩn',noteDiagnostics.missingExamples],
              ['Nốt dư so với MIDI chuẩn',noteDiagnostics.extraExamples],
              ['Nhả nốt lệch thời gian',noteDiagnostics.offsetExamples]
            ] as const).map(([label,items])=>items.length>0&&<div key={label}>
              <strong>{label}</strong>
              <div className="notiq-5nb-issues">
                {items.map((item,index)=><button type="button"
                  key={label+'-'+index} onClick={()=>seekTo(item.timeSeconds)}
                  title="Tới vị trí để nghe và sửa thủ công">
                  {noteName(item.pitchMidi)} · {fmt(item.timeSeconds)}
                  {item.errorMs!==undefined?' · lệch '+item.errorMs+' ms':''}
                </button>)}
              </div>
            </div>)}
          </div>:<small>Nạp MIDI chuẩn ở bảng 5I để chỉ rõ nốt không khớp,
            nốt dư và thời gian nhả sai. Không có MIDI chuẩn thì chỉ lọc nốt trùng cực gần,
            không tự khẳng định AI nhận diện tốt hơn.</small>}
        </div>}
        <button type="button" aria-label="Ước lượng velocity theo cường độ bản ghi"
          disabled={phase==='analyzing'||velocityBusy||!selection}
          onClick={()=>void applyAudioVelocity()}>
          {velocityBusy?'Đang đo lực nhấn…':'5N · Ước lượng mạnh–nhẹ từ âm thanh'}
        </button>
        <button type="button" aria-label="Xử lý nốt chồng cùng cao độ"
          disabled={phase==='analyzing'||noteCleanup.merged===0||
             (!!qualityReferenceScope && !!overlapBenchmark &&
               !cleanupPreservesReference(overlapBenchmark.before,overlapBenchmark.after))}
           onClick={applyOverlapCleanup}>
          Gộp {noteCleanup.merged} nốt chồng (xem trước)
        </button>
        <button type="button" aria-label="Khôi phục nốt AI gốc"
          disabled={!rawRecognitionNotes||phase==='analyzing'} onClick={restoreRawRecognition}>
          Khôi phục nốt AI gốc
        </button>
        {overlapBenchmark&&<span className="notiq-overlap-score" aria-label="F1 trước và sau gộp nốt">
          F1 theo MIDI chuẩn: trước {(overlapBenchmark.before.f1*100).toFixed(1)}% →
          sau {(overlapBenchmark.after.f1*100).toFixed(1)}% ({overlapBenchmark.change>=0?'+':''}{overlapBenchmark.change.toFixed(2)} điểm %)
        </span>}
        <small>Chỉ gộp nốt chồng cùng cao độ và nhạc cụ; không tự sửa pitch/thiếu nốt.
          {overlapBenchmark?.change!==undefined&&overlapBenchmark.change<0?
            ' MIDI tham chiếu đang cho thấy F1 giảm nếu gộp: chỉ áp dụng sau khi nghe kỹ.' :
            ' Nếu có MIDI chuẩn, kiểm F1 trước/sau rồi mới áp dụng.'}
          Có thể hoàn tác. Velocity 5N chỉ dựa trên âm lượng hỗn hợp gần thời điểm nốt,
          không khôi phục chính xác lực nhấn từng nhạc cụ. CC64 chỉ kéo dài sample
          khi có điểm nhả, không mô phỏng cộng hưởng thật.</small>
      </section>}
      {selection && (nativeReady || browserAi) && <section className="notiq-5i-toggle">
        <strong>AI 5I</strong>
        <button type="button" aria-label="Mở kiểm tra MIDI chuẩn 5I"
          aria-expanded={showBenchmark}
          onClick={()=>setShowBenchmark(v=>!v)}>
          {showBenchmark?'Ẩn bảng MIDI chuẩn':nativeReady?'5I · Đo nốt đúng/sai bằng MIDI chuẩn':'5J · Chấm MIDI trên Web'}
        </button>
        <span>{nativeReady ? 'Chọn Piano / Đa nhạc cụ · F1 tính khi có MIDI tham chiếu' : 'MuScriptor Small Web · chấm MIDI chuẩn tại thiết bị'}</span>
      </section>}
      {nativeReady && selection && showBenchmark && <BenchmarkPanel
        mode={musicMode} onMode={chooseMusicMode}
        reference={referenceMidi} onFile={file=>void loadReference(file)}
        onClear={()=>{setReferenceMidi(null);setShowScores(false)}}
        offset={referenceOffset} onOffset={setReferenceOffset}
        benchmark={benchmark}
        running={phase==='analyzing'||busyLoading}
        canCompare={nativeModelInstalled&&pianoInstalled}
        onEvaluate={evaluateReference}
        onCompare={()=>void runComparison()}
        onUse={useComparedResult}
      />}
      {!nativeReady && browserAi && selection && showBenchmark && <WebBenchmarkPanel
        mode={musicMode} onMode={setMusicMode}
        reference={referenceMidi} onReference={file=>void loadReference(file)}
        candidate={webCandidateMidi} onCandidate={file=>{
          void readReferenceMidi(file,file.name).then(parsed=>{
            setWebCandidateMidi(parsed);
            setError('');
            setStatus('Đã nhập MIDI ứng viên '+parsed.fileName+' để đối chiếu; không tự gán engine.');
          }).catch(cause=>setError('MIDI ứng viên: '+
            (cause instanceof Error?cause.message:'Không thể đọc file')));
        }}
        onClearReference={()=>{setReferenceMidi(null);setShowScores(false)}}
        onClearCandidate={()=>setWebCandidateMidi(null)}
        offset={referenceOffset} onOffset={setReferenceOffset}
        notes={notes} running={phase==='analyzing'||busyLoading}
        recognitionReady={notes.length>0}
      />}
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
            disabled={modelSwitching || nativeDownloading || benchRunning || phase === 'analyzing' || busyLoading}
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
              {nativeReady && analysisEngine === 'muscriptor' && <>
                {nativeReportedPercent !== null && <small aria-label="Tiến độ báo từ MuScriptor">
                  MuScriptor báo tiến độ {nativeReportedPercent}%; engine có thể rất lâu mới cập nhật.
                </small>}
                {recognitionElapsed >= 90 && <small>
                  Nếu không có cập nhật lâu, mở Task Manager xem CPU của notiq-muscriptor-cli.exe.
                  Large chạy CPU có thể rất chậm; không tự kết luận đã treo.
                </small>}
                <button type="button" className="notiq-cancel-inference" disabled={cancelPending}
                  onClick={() => void cancelNativeRecognition()}>
                  {cancelPending ? 'Đang yêu cầu dừng…' : 'Dừng nhận diện MuScriptor'}
                </button>
              </>}
              <small>Thanh động không phải % hoàn thành. Dừng AI không xóa MIDI đã có.</small>
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
                      title={noteName(n.pitchMidi) + ' · ' + fmt(n.startTimeSeconds) + ' · ' + n.durationSeconds.toFixed(2) + 's · Velocity '+midiVelocity(n)+'/127 · Kéo để chuyển nốt, kéo mép phải để đổi độ dài'}
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
                      className={'pedal-marker ' + (event.value === 127 ? 'pedal-on' : 'pedal-off') +
                        (selectedPedalIndex===index?' pedal-selected':'')}
                      style={{left:(event.timeSeconds / totalSeconds * 100) + '%'}}
                      title={(event.value === 127 ? 'Đạp' : 'Nhả') + ' pedal · ' + fmt(event.timeSeconds) + ' · ' + (event.trackKey === '*' ? 'Mọi track giai điệu' : event.trackKey) + ' · Nhấn để chọn và chỉnh ±10 ms'}
                      aria-label={(event.value === 127 ? 'Chọn điểm đạp' : 'Chọn điểm nhả') + ' pedal lúc ' + fmt(event.timeSeconds)}
                      aria-pressed={selectedPedalIndex===index}
                      onClick={() => setSelectedPedalIndex(index)}
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
            <label htmlFor="notiq-pedal-span">Độ dài đạp</label>
            <select id="notiq-pedal-span" value={pedalSpanSeconds}
              onChange={event=>setPedalSpanSeconds(Number(event.target.value) as 0.5|1|2)}>
              <option value={0.5}>0,5 giây</option>
              <option value={1}>1 giây</option>
              <option value={2}>2 giây</option>
            </select>
            <button type="button" disabled={!notes.length||phase==='analyzing'}
              onClick={createPedalSpan}>Thêm khoảng đạp–nhả</button>
            <span className="notiq-pedal-status">
              {pedalDownAt(pedalTrack,pedalEvents,time)?'● Đang đạp':'○ Đã nhả'}
            </span>
            {selectedPedalIndex!==null&&pedalEvents[selectedPedalIndex]&&<>
              <span className="notiq-pedal-selection">
                {pedalEvents[selectedPedalIndex].value===127?'Đạp':'Nhả'} ·
                {fmt(pedalEvents[selectedPedalIndex].timeSeconds)}
              </span>
              <button type="button" disabled={phase==='analyzing'}
                onClick={()=>nudgeSelectedPedal(-.01)}>−10 ms</button>
              <button type="button" disabled={phase==='analyzing'}
                onClick={()=>nudgeSelectedPedal(.01)}>+10 ms</button>
              <button type="button" disabled={phase==='analyzing'}
                onClick={()=>{
                  if(selectedPedalIndex===null)return;
                  const next=pedalEventsRef.current.filter((_,i)=>i!==selectedPedalIndex);
                  if(commitPedalEvents(next))setSelectedPedalIndex(null);
                }}>Xóa điểm đã chọn</button>
            </>}
            <button type="button" disabled={!pedalEvents.length || phase === 'analyzing'}
              onClick={()=>{
                if(commitPedalEvents([]))setSelectedPedalIndex(null);
              }}>Xóa pedal</button>
            <button type="button" disabled={phase==='analyzing'||pedalUndoRef.current.length===0} onClick={pedalUndo}>Hoàn tác pedal</button>
            <button type="button" disabled={phase==='analyzing'||pedalRedoRef.current.length===0} onClick={pedalRedo}>Làm lại pedal</button>
            <small>{pedalEvents.length} điểm · Bấm một dấu CC64 để chọn rồi dịch ±10 ms.
              Pedal toàn bài và theo track được ưu tiên nhất quán khi trùng thời điểm;
              xuất MIDI không kéo dài note-off. SoundFont chỉ kéo tiếng đến lúc nhả pedal
              (tối đa 8 giây), chưa mô phỏng cộng hưởng piano thật.</small>
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
