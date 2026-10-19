import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const output = resolve(root, '../NeuralNote/Assets/SoundFont');
const dest = resolve(root, 'public/soundfonts');
mkdirSync(dest, { recursive: true });
const built = resolve(output, 'NeuralNote_GM.sf3');
if (!existsSync(built)) {
  const binary = process.platform === 'win32' ? 'py' : 'python3';
  const task = spawnSync(binary, ['../Tools/fetch_soundfont.py'], {
    cwd: root, stdio: 'inherit', timeout: 300000,
  });
  if (task.error || task.status !== 0) throw new Error('SoundFont source download or verification failed.');
}
const worker = resolve(root, 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js');
if (!existsSync(worker)) throw new Error('Missing SpessaSynth audio worklet.');
copyFileSync(built, resolve(dest, 'NeuralNote_GM.sf3'));
for (const name of ['MuseScore_General_License.md', 'FluidR3Mono_License.md']) {
  const src = resolve(output, name);
  if (!existsSync(src)) throw new Error('Missing license: '+name);
  copyFileSync(src, resolve(dest, name));
}
copyFileSync(worker, resolve(root, 'public/spessasynth_processor.min.js'));
console.log('SoundFont prepared.');
