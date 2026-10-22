import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './menubar.css';
import './piano-editor.css';
import './soundfont.css';
import './muscriptor.css';
import './daw-export.css';
import './long-audio.css';
import './notiq-transport.css';
import './compare-5h.css';
import './benchmark-5i.css';
import './web-benchmark-5j.css';
import './note-quality.css';
import './benchmark-5m.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
