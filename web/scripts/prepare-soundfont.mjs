import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const output = resolve(root, '../NeuralNote/Assets/SoundFont');
const dest = resolve(root, 'public/soundfonts');
mkdirSync(dest, { recursive: true });
