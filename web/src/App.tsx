
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AudioWaveform, ChevronDown, CircleHelp, Download, FileAudio2, FolderOpen,
  Gauge, Headphones, Info, LoaderCircle, Music, Pause, Play, RotateCcw,
  Settings2, SkipBack, SlidersHorizontal, Sparkles, Square, Upload, Volume2,
  X, ZoomIn, ZoomOut } from 'lucide-react';
import { fmt, generateDemo, groupFor, GROUPS, makeMidi, noteName, readAudio, transcribe } from './audio';
import type { Note, AudioInfo, PitchGroup } from './audio';

type Selection = { file: Blob; name: string; url: string };
type Phase = 'empty' | 'ready' | 'analyzing' | 'complete' | 'error';
type PlaybackMode = 'original' | 'midi' | 'mix';
const PITCH_ROW = 16;
const midiColor = (pitch: number) => GROUPS.find(group => group.id === groupFor(pitch))?.color || '#59bfa3';

function App() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [info, setInfo] = useState<AudioInfo | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [phase, setPhase] = useState<Phase>('empty');
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
  const [masterVolume, setMasterVolume] = useState(0.65);
  const [showSettings, setShowSettings] = useState(false);
  const [dragging, setDragging] = useState(false);
  const audioEl = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const keyColumn = useRef<HTMLDivElement>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const firedNotes = useRef<Set<number>>(new Set());
  const previousTime = useRef(0);
  const selectionRef = useRef<Selection | null>(null);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  useEffect(() => () => {
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    if (audioCtx.current) void audioCtx.current.close().catch(() => undefined);
  }, []);

  const pitchBottom = Math.min(36, notes.length ? Math.max(21, Math.floor(Math.min(...notes.map(n => n.pitchMidi)) / 12) * 12) : 36);
  const pitchTop = Math.max(92, notes.length ? Math.min(108, Math.ceil(Math.max(...notes.map(n => n.pitchMidi)) / 12) * 12 + 11) : 92);
  const gridHeight = (pitchTop - pitchBottom + 1) * PITCH_ROW;
  const pitches = Array.from({ length: pitchTop - pitchBottom + 1 }, (_, i) => pitchTop - i);
  const totalSeconds = Math.max(1, info?.duration || 8);
  const timelineWidth = Math.max(1000, Math.round(totalSeconds * 80 * zoom));
  const activeGroups = useMemo(
    () => new Set(GROUPS.filter(g => !muted.has(g.id) && (!solo || solo === g.id)).map(g => g.id)),
    [muted, solo],
  );
  const visibleNotes = useMemo(() => notes.filter(n => activeGroups.has(groupFor(n.pitchMidi))), [notes, activeGroups]);
  const summary = useMemo(() => {
    if (!notes.length) return 'Chưa có nốt';
    const pitches = notes.map(n => n.pitchMidi);
    return notes.length.toLocaleString('vi-VN') + ' nốt · ' + noteName(Math.min(...pitches)) + ' – ' + noteName(Math.max(...pitches));
  }, [notes]);

  const setAudio = async (file: Blob, name: string) => {
    if (phase === 'analyzing' || busyLoading) return;
    if (!/\.(wav|mp3|flac|ogg|m4a|aac|aiff)$/i.test(name)) {
      setError('Định dạng chưa hỗ trợ. Hãy chọn WAV, MP3, FLAC, OGG hoặc M4A phù hợp với trình duyệt.');
      setPhase('error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('Tệp lớn hơn 50 MB. Hãy chọn đoạn âm thanh nhỏ hơn.');
      setPhase('error');
      return;
    }
    setBusyLoading(true);
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    selectionRef.current = null;
    setSelection(null);
    setError('');
    setPlaying(false);
    setNotes([]);
    setInfo(null);
    setTime(0);
    setProgress(0);
    firedNotes.current.clear();
    if (audioEl.current) audioEl.current.pause();
    try {
      const decoded = await readAudio(file);
      if (decoded.duration > 45) throw new Error('Bản thử nghiệm chỉ xử lý tối đa 45 giây. Vui lòng cắt đoạn cần nhận diện.');
      const next = { file, name, url: URL.createObjectURL(file) };
      selectionRef.current = next;
      setSelection(next);
      setInfo(decoded);
      setPhase('ready');
      setStatus('Đã đọc âm thanh · Sẵn sàng nhận diện');
    } catch (cause) {
      setPhase('error');
      setStatus('Không thể mở âm thanh');
      setError(cause instanceof Error ? cause.message : 'Không thể đọc tệp.');
    } finally {
      setBusyLoading(false);
    }
  };

  const startInference = async () => {
    if (!selection || phase === 'analyzing') return;
    if (audioEl.current) audioEl.current.pause();
    setPlaying(false);
    setPhase('analyzing');
    setError('');
    setProgress(0);
    try {
      const detected = await transcribe(selection.file, (message, percentage) => {
        setStatus(message);
        setProgress(percentage);
      });
      setNotes(detected);
      setProgress(100);
      setPhase('complete');
      setStatus(detected.length ? 'Đã nhận diện ' + detected.length + ' nốt' : 'Không tìm thấy nốt rõ ràng trong âm thanh');
      firedNotes.current.clear();
    } catch (cause) {
      setPhase('error');
      setError((cause instanceof Error ? cause.message : 'Có lỗi xảy ra') + ' · Hãy kiểm tra mạng khi tải mô hình hoặc thử tệp WAV ngắn.');
      setStatus('Không thể nhận diện');
    }
  };

  const oscPreview = async (pitch: number, length = 0.35, volume = 0.65) => {
    const ctx = audioCtx.current || new AudioContext();
    audioCtx.current = ctx;
    if (ctx.state !== 'running') await ctx.resume();
    const oscillator = ctx.createOscillator();
    const env = ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    const level = Math.max(0.004, Math.min(0.2, volume * 0.15));
    env.gain.setValueAtTime(0.0001, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + Math.max(0.06, length));
    oscillator.connect(env).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + Math.max(0.07, length) + 0.02);
  };

  useEffect(() => {
    if (!playing || !notes.length || playbackMode === 'original') return;
    const interval = window.setInterval(() => {
      const now = audioEl.current?.currentTime || 0;
      if (now + 0.25 < previousTime.current || Math.abs(now - previousTime.current) > 0.5) firedNotes.current.clear();
      previousTime.current = now;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const group = groupFor(n.pitchMidi);
        if (!activeGroups.has(group) || firedNotes.current.has(i)) continue;
        if (n.startTimeSeconds >= now - 0.10 && n.startTimeSeconds <= now + 0.055) {
          firedNotes.current.add(i);
          void oscPreview(n.pitchMidi, Math.min(0.85, n.durationSeconds), gain[group] * masterVolume);
        }
      }
    }, 45);
    return () => window.clearInterval(interval);
  }, [playing, notes, playbackMode, activeGroups, gain, masterVolume]);

  useEffect(() => {
    if (audioEl.current) audioEl.current.volume = playbackMode === 'midi' ? 0 : masterVolume * (playbackMode === 'mix' ? 0.65 : 1);
  }, [playbackMode, masterVolume, selection]);

  const togglePlayback = async () => {
    const audio = audioEl.current;
    if (!audio || !info) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      try {
        if (playbackMode !== 'original') {
          const synth = audioCtx.current || new AudioContext();
          audioCtx.current = synth;
          await synth.resume();
        }
        firedNotes.current.clear();
        await audio.play();
        setPlaying(true);
      } catch {
        setError('Không thể phát âm thanh. Hãy cho phép trình duyệt phát media.');
      }
    }
  };
  const seekTo = (seconds: number) => {
    if (!audioEl.current) return;
    const clamped = Math.max(0, Math.min(info?.duration || 0, seconds));
    audioEl.current.currentTime = clamped;
    setTime(clamped);
    previousTime.current = clamped;
    firedNotes.current.clear();
  };
  const stop = () => {
    if (audioEl.current) audioEl.current.pause();
    setPlaying(false);
    seekTo(0);
  };
  const toggleMute = (id: PitchGroup) => {
    setMuted(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exportFile = () => {
    if (!visibleNotes.length) return;
    const blob = makeMidi(notes, bpm, activeGroups);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (selection?.name.replace(/\.[^.]+$/, '') || 'NOTIQ') + '.mid';
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const reset = () => {
    stop();
    setSelection(null);
    setInfo(null);
    setNotes([]);
    setTime(0);
    setPhase('empty');
    setError('');
    setProgress(0);
    setStatus('Chưa tải tệp âm thanh');
    firedNotes.current.clear();
    if (selectionRef.current) URL.revokeObjectURL(selectionRef.current.url);
    selectionRef.current = null;
  };
  const peakBars = info?.peaks || [];
  const markers = Array.from({ length: Math.ceil(totalSeconds) + 1 }, (_, i) => i);
  const cursorX = time / totalSeconds * timelineWidth;
  const onDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      void setAudio(file, file.name);
    }
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
      <div className="osbar">
        <span className="os-title"><AudioWaveform size={17} /> <strong>NOTIQ</strong> <b>WEB STUDIO</b></span>
        <div className="os-actions">
          <span className="lunor">LUNOR <b>MUSIC</b></span>
          <a href="https://github.com/Gamevalentine/NeuralNote" target="_blank" rel="noreferrer">Mã nguồn ↗</a>
          <button className="os-settings" onClick={() => setShowSettings(!showSettings)} title="Cài đặt" aria-label="Cài đặt"><Settings2 size={16} /></button>
        </div>
      </div>
      <div className="notice"><Info size={15} /> <strong>Bản thử nghiệm</strong> — bố cục theo NeuralNote; AI Basic Pitch chưa tách Piano/Guitar/Drums. Ba hàng là <b>dải cao độ thực tế</b>, không phải nhạc cụ AI nhận dạng.</div>
      <div className="transport">
        <div className="logo"><div className="logo-box">N</div><strong>NOTIQ</strong><small>v0.2</small></div>
        <div className="transport-buttons">
          <button title="Về đầu" onClick={() => seekTo(0)} disabled={!info}><SkipBack size={16} /></button>
          <button title={playing ? 'Tạm dừng' : 'Phát'} onClick={togglePlayback} disabled={!info} className="transport-play">{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
          <button title="Dừng" onClick={stop} disabled={!info}><Square size={12} fill="currentColor" /></button>
          <button title="Phát lặp" className={loop ? 'is-active' : ''} onClick={() => setLoop(!loop)}><RotateCcw size={17} /></button>
        </div>
        <div className="transport-time"><strong>{fmt(time)}</strong><span>/ {fmt(info?.duration || 0)}</span></div>
        <div className="model-token"><Sparkles size={15} /><span>AI: BASIC PITCH</span></div>
        <div className="transport-select">
          <label htmlFor="playmode">NGHE</label>
          <div className="select-wrap"><select id="playmode" value={playbackMode} onChange={event => setPlaybackMode(event.target.value as PlaybackMode)}><option value="mix">Gốc + MIDI</option><option value="original">Âm gốc</option><option value="midi">MIDI</option></select><ChevronDown size={12} /></div>
        </div>
        <div className="master-output"><Volume2 size={17} /><input aria-label="Âm lượng chung" type="range" value={masterVolume} min={0} max={1} step={0.01} onChange={e => setMasterVolume(Number(e.target.value))} /></div>
        <button className="icon-button" onClick={() => setShowSettings(!showSettings)} title="Tùy chọn"><SlidersHorizontal size={16}/></button>
      </div>
      {showSettings && <div className="settings-popup">
        <div className="popup-head"><strong><Gauge size={17} /> Tùy chọn NOTIQ</strong><button aria-label="Đóng" onClick={() => setShowSettings(false)}><X size={16} /></button></div>
        <label>Tempo xuất MIDI (BPM)<input type="number" min={40} max={240} value={bpm} onChange={e => setBpm(Math.min(240, Math.max(40, Number(e.target.value) || 120)))} /></label>
        <p>Giới hạn bản thử nghiệm: 45 giây · 50 MB.</p>
        <p>Âm thanh xử lý tại thiết bị của bạn. Mô hình AI tải qua Internet khi cần.</p>
        <p>Engine MuScriptor đa nhạc cụ của NeuralNote v2 chưa được tích hợp vào bản web này.</p>
      </div>}
      <div className="studio">
        <aside className="sidebar">
          <div className="sidebar-heading"><span>NHÓM NỐT / DẢI ÂM</span><span>{notes.length ? GROUPS.length : 0}</span></div>
          <div className="track-explainer">Basic Pitch • nhóm theo cao độ</div>
          {GROUPS.map(group => {
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
              </div>
            );
          })}
          <div className="side-bottom"><strong>ĐẦU RA</strong><div className="bar-dummy"/><p>{summary}</p></div>
        </aside>
        <section className="editor">
          <div className="editor-toolbar">
            <div className="filename"><FileAudio2 size={17}/><span title={selection?.name}>{selection?.name || 'Chưa có âm thanh · chọn tệp để bắt đầu'}</span>{selection && <button className="remove-file" onClick={reset} title="Xóa âm thanh" disabled={phase === 'analyzing'}><X size={15}/></button>}</div>
            <div className="file-actions">
              <button className="action-outline" onClick={() => fileInput.current?.click()} disabled={busyLoading || phase === 'analyzing'}><FolderOpen size={15}/> Mở tệp</button>
              <button className="action-outline" onClick={() => void setAudio(generateDemo(), 'NOTIQ - giai điệu mẫu.wav')} disabled={busyLoading || phase === 'analyzing'}><Music size={15}/> Nhạc mẫu</button>
              <label className="tempo-chip">BPM <input type="number" min={40} max={240} value={bpm} onChange={e => setBpm(Math.min(240, Math.max(40, Number(e.target.value) || 120)))} /></label>
              <button className="primary-action" onClick={startInference} disabled={!selection || phase === 'analyzing'}>{phase === 'analyzing' ? <LoaderCircle className="spin" size={15}/> : <Sparkles size={15}/>} {phase === 'analyzing' ? 'Đang nhận diện' : 'Nhận diện'}</button>
              <button className="export-action" onClick={exportFile} disabled={!visibleNotes.length}><Download size={15}/> Xuất MIDI</button>
            </div>
          </div>
          <div className="workarea">
            <div className="keyboard" ref={keyColumn}>
              <div className="wave-key-label">WAVE<br/>FORM</div>
              <div className="ruler-key-label">THỜI GIAN</div>
              {pitches.map(pitch => <button key={pitch} type="button" onClick={() => void oscPreview(pitch)} title={'Nghe nốt ' + noteName(pitch)} className={'key ' + ([1,3,6,8,10].includes(pitch%12) ? 'black' : 'white')}>{pitch % 12 === 0 ? noteName(pitch) : ''}</button>)}
            </div>
            <div className="scroller" onScroll={event => { if (keyColumn.current) keyColumn.current.scrollTop = event.currentTarget.scrollTop; }}>
              <div className="timeline" style={{ width: timelineWidth }}>
                <div className={'wave-panel ' + (dragging ? 'dragging' : '')} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDropFile}>
                  {peakBars.length ? (
                    <svg width="100%" height="100%" viewBox={'0 0 ' + timelineWidth + ' 106'} preserveAspectRatio="none" aria-label="Dạng sóng âm thanh">
                      <line x1="0" y1="53" x2={timelineWidth} y2="53" stroke="#4b5669" strokeWidth=".8"/>
                      {peakBars.map((amp,i) => {
                        const h = Math.max(1, amp * 42);
                        const x = i / peakBars.length * timelineWidth;
                        return <line key={i} x1={x} y1={53-h} x2={x} y2={53+h} stroke={x < cursorX ? '#7797b8' : '#9caabf'} strokeWidth={Math.max(1,timelineWidth/peakBars.length*0.64)}/>;
                      })}
                    </svg>
                  ) : <div className="wave-empty" onClick={() => fileInput.current?.click()}><Upload size={25}/><strong>Kéo thả âm thanh vào đây hoặc chọn Mở tệp</strong><small>WAV · MP3 · FLAC · OGG · M4A · Tối đa 45 giây</small></div>}
                  <span className="wave-caption">{info ? 'DẠNG SÓNG ÂM THANH' : 'CHƯA CÓ DỮ LIỆU ÂM THANH'}</span>
                </div>
                <div className="ruler">
                  {markers.map(n => <button type="button" key={n} className="tick" style={{ left: n/totalSeconds*100 + '%' }} onClick={() => seekTo(n)}>{n}s</button>)}
                </div>
                <div className="roll" style={{ height: gridHeight }}>
                  {pitches.map(pitch => <div className={'pitch-grid ' + (pitch%12 === 0 ? 'octave' : '')} key={pitch} style={{top:(pitchTop-pitch)*PITCH_ROW,height:PITCH_ROW}}/>)}
                  {markers.map(n => <div key={n} className="beat-grid" style={{left: n/totalSeconds*100 + '%'}}/>)}
                  {visibleNotes.map((n,i) => (
                    <button className="note" key={i} title={noteName(n.pitchMidi) + ' · ' + fmt(n.startTimeSeconds) + ' · ' + n.durationSeconds.toFixed(2) + 's'}
                      onClick={() => void oscPreview(n.pitchMidi, Math.min(0.45,n.durationSeconds))}
                      style={{
                        top:(pitchTop-n.pitchMidi)*PITCH_ROW + 1,
                        left:n.startTimeSeconds/totalSeconds*100 + '%',
                        width:Math.max(3,n.durationSeconds/totalSeconds*timelineWidth-1),
                        backgroundColor:midiColor(n.pitchMidi),borderColor:midiColor(n.pitchMidi),
                      }}>{n.durationSeconds/totalSeconds*timelineWidth > 39 ? noteName(n.pitchMidi) : ''}</button>
                  ))}
                  {!notes.length && <div className="empty-roll">{phase === 'analyzing' ? <><LoaderCircle className="spin" size={26}/><strong>AI đang nhận diện nốt...</strong></> : <><Music size={27}/><strong>{selection ? 'Đã tải âm thanh — nhấn Nhận diện' : 'Piano Roll đang trống'}</strong><small>Chỉ hiển thị nốt thật sau khi chạy AI</small></>}</div>}
                </div>
                {info && <div className="playhead" style={{left:cursorX,height:106+28+gridHeight}}/>}
              </div>
            </div>
          </div>
          <div className="editor-status">
            <span>{status}</span>
            {phase === 'analyzing' && <div className="progress-track"><div style={{width: progress+'%'}}/></div>}
            <span>{phase === 'analyzing' ? progress+'%' : summary}</span>
            <div className="zoom-controls"><button onClick={()=>setZoom(Math.max(0.5,zoom/1.25))} title="Thu nhỏ"><ZoomOut size={15}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(Math.min(4,zoom*1.25))} title="Phóng to"><ZoomIn size={15}/></button></div>
          </div>
          {error && <div className="error-banner" role="alert"><Info size={15}/>{error}<button aria-label="Đóng lỗi" onClick={()=>setError('')}><X size={15}/></button></div>}
        </section>
      </div>
      <footer className="app-footer"><span><Headphones size={13}/> Nhận diện Audio → MIDI thực tế · xử lý trong trình duyệt</span><span><CircleHelp size={13}/> Basic Pitch không phân loại nhạc cụ · <a href="https://github.com/spotify/basic-pitch-ts" target="_blank" rel="noreferrer">Apache-2.0</a></span></footer>
      <input ref={fileInput} type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff,audio/*" className="hidden" onChange={e => {if(e.target.files?.[0])void setAudio(e.target.files[0],e.target.files[0].name);e.target.value='';}}/>
    </main>
  );
}
export default App;
