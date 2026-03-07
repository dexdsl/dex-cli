#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileSidebarCredits } from './lib/entry-html.mjs';

function extractLinksFromPin(markup) {
  const match = String(markup || '').match(/data-links='([^']+)'/i);
  if (!match) return [];
  const decoded = String(match[1])
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return JSON.parse(decoded);
}

const compiled = compileSidebarCredits({
  artist: ['Tim Feeney'],
  instruments: ['Prepared Floor Tom'],
  instrumentLinksEnabled: false,
  linksByPerson: {
    'tim feeney': [
      { label: 'Website', href: 'https://example.com' },
      { label: 'Website', href: 'https://example.com' },
    ],
    'Prepared Floor Tom': [
      { label: 'Spec', href: 'https://example.com/spec' },
    ],
  },
  video: {
    director: ['Tim Feeney'],
    cinematography: [],
    editing: [],
  },
  audio: {
    recording: ['Tim Feeney'],
    mix: [],
    master: [],
  },
  year: 2024,
  season: 'S2',
  location: 'NYC',
});

const artistLinks = extractLinksFromPin(compiled.artist);
assert.equal(artistLinks.length, 1, 'artist links should be deduped');
assert.equal(artistLinks[0].label, 'Website');

const instrumentMarkup = String(compiled.instruments?.[0] || '');
const instrumentLinks = extractLinksFromPin(instrumentMarkup);
assert.equal(instrumentLinks.length, 0, 'instrument links should be disabled by default');

const withInstrumentLinks = compileSidebarCredits({
  ...compiled,
  artist: ['Tim Feeney'],
  instruments: ['Prepared Floor Tom'],
  instrumentLinksEnabled: true,
  linksByPerson: {
    'Prepared Floor Tom': [{ label: 'Spec', href: 'https://example.com/spec' }],
  },
  video: { director: [], cinematography: [], editing: [] },
  audio: { recording: [], mix: [], master: [] },
});
const enabledLinks = extractLinksFromPin(String(withInstrumentLinks.instruments?.[0] || ''));
assert.equal(enabledLinks.length, 1, 'instrument links should appear when enabled');

console.log('ok credits links compile');
