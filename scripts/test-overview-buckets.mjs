import assert from 'node:assert/strict';

const ALL_BUCKETS = ['A', 'B', 'C', 'D', 'E', 'X'];

const buildBucketsHtml = (pageBuckets) => {
  const selected = Array.isArray(pageBuckets) ? pageBuckets : [];
  return ALL_BUCKETS
    .map((bucket) => {
      const cls = selected.includes(bucket) ? 'available' : 'unavailable';
      return `<span class="badge ${cls}">${bucket}</span>`;
    })
    .join('');
};

const html = buildBucketsHtml(['A', 'C']);

for (const bucket of ALL_BUCKETS) {
  assert.ok(html.includes(`>${bucket}</span>`), `missing bucket ${bucket}`);
}

assert.ok(html.includes('<span class="badge available">A</span>'));
assert.ok(html.includes('<span class="badge available">C</span>'));
for (const bucket of ['B', 'D', 'E', 'X']) {
  assert.ok(
    html.includes(`<span class="badge unavailable">${bucket}</span>`),
    `expected ${bucket} to be unavailable`,
  );
}

console.log('overview bucket badge test passed');
