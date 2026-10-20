import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INSTRUMENTS, INSTRUMENTS, instrumentProgram } from '../src/soundfont.ts';

test('NOTIQ includes sampled Piano/Guitar/Bass presets by default', () => {
  assert.equal(DEFAULT_INSTRUMENTS.high, 'acoustic_grand_piano');
  assert.equal(DEFAULT_INSTRUMENTS.mid, 'acoustic_guitar_nylon');
  assert.equal(DEFAULT_INSTRUMENTS.low, 'electric_bass_finger');
});

test('Each sample-based instrument has a unique GM program (0-127)', () => {
  const programs = INSTRUMENTS.map(item => item.program);
  assert.equal(new Set(programs).size, programs.length);
  assert.equal(INSTRUMENTS.length, 6);
  for (const item of INSTRUMENTS) {
    assert.equal(instrumentProgram(item.id), item.program);
    assert.ok(item.program >= 0 && item.program < 128);
  }
});

test('The soundfont names are legal sample-bank URL path segments', () => {
  for (const item of INSTRUMENTS) {
    assert.match(item.id, /^[a-z0-9_]+$/);
  }
});
