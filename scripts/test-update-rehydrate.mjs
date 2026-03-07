import assert from 'node:assert/strict';
import { loadTagsCatalog } from './lib/tags.mjs';

const tags = await loadTagsCatalog();
assert.ok(Array.isArray(tags));
const used = ['ambient', 'unknown-tag'];
const unknown = used.filter((t) => !tags.includes(t));
assert.deepEqual(unknown, ['unknown-tag']);
console.log('ok update rehydrate');
