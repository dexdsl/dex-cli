import { normalizeCallLane } from './call-lookup.mjs';

function toText(value) {
  return String(value || '').trim();
}

function normalizeSubcall(value) {
  const subcall = toText(value).toLowerCase();
  return subcall === 'a' || subcall === 'b' || subcall === 'c' ? subcall : '';
}

export function buildSubmitCallHref({ lane = '', subcall = '', cycle = '', via = 'call' } = {}) {
  const safeLane = normalizeCallLane(lane);
  const safeSubcall = normalizeSubcall(subcall);
  const params = new URLSearchParams();
  params.set('flow', 'call');
  if (safeLane) params.set('lane', safeLane);
  if (safeSubcall) params.set('subcall', safeSubcall);
  if (toText(cycle)) params.set('cycle', toText(cycle));
  if (toText(via)) params.set('via', toText(via));
  return `/entry/submit/?${params.toString()}`;
}
