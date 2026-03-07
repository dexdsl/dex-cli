import fs from 'node:fs/promises';

export async function loadTagsCatalog(tagsPath = new URL('../data/tags.json', import.meta.url)) {
  try {
    const raw = await fs.readFile(tagsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tag) => String(tag || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}
