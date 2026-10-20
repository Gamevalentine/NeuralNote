import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../vendor/muscriptor/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('SOURCE_MANIFEST.json', root), 'utf8'));
test('MuScriptor source copy must retain pinned revision and license', async () => {
  assert.equal(manifest.source_commit, 'c8adc019677ed3479fa3c22c1a117d662382f347');
  assert.equal(manifest.weights_included, false);
  assert.equal(manifest.files.length, 39);
});
for (const f of manifest.files) {
  test('Verify original Git blob: ' + f.path, async () => {
    const bytes = await readFile(new URL(f.path, root));
    assert.equal(bytes.length, f.bytes);
    const digest = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(digest, f.sha);
  });
}
