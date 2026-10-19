
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AudioWaveform, CircleHelp, Gauge, Headphones, Info, LoaderCircle,
  Music, Settings2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { fmt, generateDemo, groupFor, GROUPS, makeMidi, noteName, readAudio, transcribe } from './audio';
import type { Note, AudioInfo, PitchGroup } from './audio';
import { GM_PRESETS, NeuralNoteSoundFont } from './soundfont';
import type { Programs } from './soundfont';

type Selection = { file: Blob; name: string; url: string };
type Phase = 'empty' | 'ready' | 'analyzing' | 'complete' | 'error';
type PlaybackMode = 'original' | 'midi' | 'mix';
type MenuKey = 'file' | 'edit' | 'play' | 'track' | 'instrument' | 'tools' | 'view' | 'export';
type MenuAction = { label: string; run: () => void; disabled?: boolean; checked?: boolean; shortcut?: string };
type AppMenu = { id: MenuKey; label: string; commands: MenuAction[] };
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
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 43 });
  const audioEl = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const keyColumn = useRef<HTMLDivElement>(null);
  const timelineViewport = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
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
  useEffect(() => {
    const onOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setActiveMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActiveMenu(null); setShowSettings(false); }
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
        { label: 'Mở âm thanh…', run: () => fileInput.current?.click(), disabled: busyLoading || phase === 'analyzing' },
        { label: 'Dùng nhạc mẫu', run: () => void setAudio(generateDemo(), 'NOTIQ - giai điệu mẫu.wav'), disabled: busyLoading || phase === 'analyzing' },
        { label: 'Đóng tệp đang mở', run: reset, disabled: !selection || phase === 'analyzing' },
      ],
    },
    {
      id: 'edit', label: 'Chỉnh sửa', commands: [
        { label: 'Xóa kết quả nhận diện', run: () => { setNotes([]); setPhase(selection ? 'ready' : 'empty'); setStatus('Đã xóa kết quả MIDI'); firedNotes.current.clear(); }, disabled: notes.length === 0 || phase === 'analyzing' },
        { label: 'Về đầu bản nhạc', run: () => seekTo(0), disabled: !info },
      ],
    },
    {
      id: 'play', label: 'Phát lại', commands: [
        { label: playing ? 'Tạm dừng' : 'Phát', run: () => void togglePlayback(), disabled: !info },
        { label: 'Dừng và về đầu', run: stop, disabled: !info },
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
        { label: 'Xuất MIDI (.mid)', run: exportFile, disabled: !visibleNotes.length },
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

      <header className="osbar" ref={menuRef}>
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
          <span className="lunor">LUNOR <b>MUSIC</b></span>
          <a href="https://github.com/Gamevalentine/NeuralNote" target="_blank" rel="noreferrer">Mã nguồn ↗</a>
          <button type="button" className="os-settings" onClick={() => { setActiveMenu(null); setShowSettings(!showSettings); }} title="Cài đặt" aria-label="Cài đặt"><Settings2 size={16} /></button>
        </div>
      </header>
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
          <div className="workarea">
            <div className="keyboard" ref={keyColumn}>
              <div className="ruler-key-label">THỜI GIAN</div>
              {pitches.map(pitch => <button key={pitch} type="button" onClick={() => void oscPreview(pitch)} title={'Nghe nốt ' + noteName(pitch)} className={'key ' + ([1,3,6,8,10].includes(pitch%12) ? 'black' : 'white')}>{pitch % 12 === 0 ? noteName(pitch) : ''}</button>)}
            </div>
            <div className="scroller" ref={timelineViewport} onDragOver={event => event.preventDefault()} onDrop={onDropFile} onScroll={event => { if (keyColumn.current) keyColumn.current.scrollTop = event.currentTarget.scrollTop; }}>
              <div className="timeline" style={{ width: timelineWidth }}>
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
                {info && <div className="playhead" style={{left:cursorX,height:28+gridHeight}}/>}
              </div>
            </div>
          </div>
          <div className="editor-status">
            <span>{status}</span>
            {phase === 'analyzing' && <div className="progress-track"><div style={{width: progress+'%'}}/></div>}
            <span>{phase === 'analyzing' ? progress+'%' : summary}</span>
            <span className="compact-clock">{fmt(time)} / {fmt(info?.duration || 0)}</span>
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
