export function computeWindow({ total, cursor, height, pad = 1 }) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeHeight = Math.max(1, Number(height) || 1);
  if (safeTotal <= safeHeight) return { start: 0, end: safeTotal };

  const maxStart = Math.max(0, safeTotal - safeHeight);
  let start = Math.max(0, Math.min(maxStart, (Number(cursor) || 0) - pad));
  let end = Math.min(safeTotal, start + safeHeight);
  if ((Number(cursor) || 0) >= end) {
    end = Math.min(safeTotal, (Number(cursor) || 0) + pad + 1);
    start = Math.max(0, end - safeHeight);
  }
  if ((Number(cursor) || 0) < start) {
    start = Math.max(0, (Number(cursor) || 0) - pad);
    end = Math.min(safeTotal, start + safeHeight);
  }
  return { start, end };
}
