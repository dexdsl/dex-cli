import { createDefaultWizardForm, validateStep } from './ui/init-wizard.mjs';

const base = createDefaultWizardForm();
const emptyBucketsError = validateStep('buckets', { ...base, buckets: [] });
if (emptyBucketsError !== 'Select at least one bucket.') {
  throw new Error(`expected buckets validation error, got: ${String(emptyBucketsError)}`);
}

const missingBucketsError = validateStep('buckets', { ...base, buckets: undefined });
if (missingBucketsError !== 'Select at least one bucket.') {
  throw new Error(`expected defensive buckets validation error, got: ${String(missingBucketsError)}`);
}

const ok = validateStep('buckets', { ...base, buckets: ['A'] });
if (ok != null) {
  throw new Error(`expected no buckets validation error, got: ${String(ok)}`);
}

const defaultCreditsError = validateStep('credits', base);
if (defaultCreditsError !== 'Artist(s) needs at least one name.') {
  throw new Error(`expected default credits validation error, got: ${String(defaultCreditsError)}`);
}

const populatedCredits = {
  ...base,
  creditsData: {
    ...base.creditsData,
    artist: ['A'],
    instruments: ['B'],
    video: { director: ['C'], cinematography: ['D'], editing: ['E'] },
    audio: { recording: ['F'], mix: ['G'], master: ['H'] },
    year: '2024',
    season: 'S1',
    location: 'Somewhere',
  },
};
const creditsOk = validateStep('credits', populatedCredits);
if (creditsOk != null) {
  throw new Error(`expected no credits validation error, got: ${String(creditsOk)}`);
}

console.log('test-init-wizard-validate ok');
