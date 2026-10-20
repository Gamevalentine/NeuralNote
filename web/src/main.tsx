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

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
