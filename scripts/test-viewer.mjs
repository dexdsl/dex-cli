import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractYouTubeId } from './lib/entry-html.mjs';
import { loadRecents, pushRecent } from './lib/recents-store.mjs';
import { resolveSafePathUnderRoot } from './lib/viewer-server.mjs';

assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=CSFGiU1gg4g&feature=youtu.be'), 'CSFGiU1gg4g');
assert.equal(extractYouTubeId('www.youtube.com/watch?v=CSFGiU1gg4g'), 'CSFGiU1gg4g');
assert.equal(extractYouTubeId('https://youtu.be/CSFGiU1gg4g?si=abc123'), 'CSFGiU1gg4g');
assert.equal(extractYouTubeId('youtu.be/CSFGiU1gg4g?si=abc123'), 'CSFGiU1gg4g');
assert.equal(extractYouTubeId('https://www.youtube.com/embed/CSFGiU1gg4g?source_ve_path=MjM4NTE'), 'CSFGiU1gg4g');
assert.equal(extractYouTubeId('https://example.com/watch?v=CSFGiU1gg4g'), '');
assert.equal(extractYouTubeId('not-a-url'), '');

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dex-recents-test-'));
const storePath = path.join(tempDir, 'recent.json');

await pushRecent('/tmp/demo-a/index.html', { displayName: 'A', timestamp: 1000, storePath });
await pushRecent('/tmp/demo-b/index.html', { displayName: 'B', timestamp: 2000, storePath });
await pushRecent('/tmp/demo-a/index.html', { displayName: 'A2', timestamp: 3000, storePath });

let recents = await loadRecents({ filePath: storePath, max: 10 });
assert.equal(recents.length, 2);
assert.equal(recents[0].path, path.resolve('/tmp/demo-a/index.html'));
assert.equal(recents[0].displayName, 'A2');

await pushRecent('/tmp/demo-c/index.html', { displayName: 'C', timestamp: 4000, storePath, max: 2 });
recents = await loadRecents({ filePath: storePath, max: 10 });
assert.equal(recents.length, 2);
assert.equal(recents[0].path, path.resolve('/tmp/demo-c/index.html'));
assert.equal(recents[1].path, path.resolve('/tmp/demo-a/index.html'));

const root = path.resolve('/tmp/view-root');
assert.equal(resolveSafePathUnderRoot(root, ''), root);
assert.equal(resolveSafePathUnderRoot(root, 'entry/index.html'), path.join(root, 'entry', 'index.html'));
assert.equal(resolveSafePathUnderRoot(root, '../secrets.txt'), null);
assert.equal(resolveSafePathUnderRoot(root, 'entry/../../secrets.txt'), null);
assert.equal(resolveSafePathUnderRoot(root, 'entry\\..\\..\\secrets.txt'), null);

console.log('ok viewer helpers');
