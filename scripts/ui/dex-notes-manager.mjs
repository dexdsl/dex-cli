import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { computeWindow } from './rolodex.mjs';
import { isBackspaceKey, shouldAppendWizardChar } from '../lib/input-guard.mjs';
import {
  listMarkdownPostFiles,
  parseMdWithJsonFrontmatter,
  toText,
} from '../lib/dexnotes-pipeline.mjs';
import { runDexNotesCommand } from '../lib/dex-notes-cli.mjs';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeMessage(error) {
  return error?.message || String(error || 'Unknown error');
}

function loadPosts() {
  const files = listMarkdownPostFiles();
  return files.map((filePath) => {
    const parsed = parseMdWithJsonFrontmatter(filePath);
    return {
      filePath,
      slug: toText(parsed?.frontmatter?.slug),
      title: toText(parsed?.frontmatter?.title_raw),
      published: toText(parsed?.frontmatter?.published_at_iso),
      excerpt: toText(parsed?.frontmatter?.excerpt_raw),
    };
  });
}

export function DexNotesManager({ onExit, width = 100, height = 24 }) {
  const [posts, setPosts] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading Dex Notes posts…');
  const [inputMode, setInputMode] = useState('');
  const [inputValue, setInputValue] = useState('');

  const selected = useMemo(() => posts[selectedIndex] || null, [posts, selectedIndex]);

  const reload = useCallback(() => {
    try {
      const next = loadPosts();
      setPosts(next);
      setSelectedIndex(0);
      setStatusLine(`Loaded ${next.length} Dex Notes posts.`);
    } catch (error) {
      setStatusLine(`Load failed: ${safeMessage(error)}`);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!posts.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((previous) => clamp(previous, 0, posts.length - 1));
  }, [posts.length]);

  const runAction = useCallback(async (runner, successLine) => {
    setBusy(true);
    try {
      await runner();
      reload();
      setStatusLine(successLine);
    } catch (error) {
      setStatusLine(`Action failed: ${safeMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [reload]);

  useInput((input, key) => {
    if (inputMode) {
      if (key.escape) {
        setInputMode('');
        setInputValue('');
        setStatusLine('Cancelled.');
        return;
      }
      if (key.return) {
        const value = toText(inputValue);
        if (inputMode === 'add-title' && value) {
          setInputMode('');
          setInputValue('');
          void runAction(
            async () => runDexNotesCommand(['add', '--title', value, '--excerpt', value, '--category', 'Update', '--categoryLabel', 'Update', '--author', 'dex-team', '--authorName', 'dex Team']),
            `Created note: ${value}`,
          );
          return;
        }
        if (inputMode === 'set-title' && selected && value) {
          setInputMode('');
          setInputValue('');
          void runAction(
            async () => runDexNotesCommand(['set', '--slug', selected.slug, '--field', 'title_raw', '--value', value]),
            `Updated title for ${selected.slug}`,
          );
          return;
        }
        return;
      }
      if (isBackspaceKey(input, key) || key.delete) {
        setInputValue((previous) => previous.slice(0, -1));
        return;
      }
      if (shouldAppendWizardChar(input, key)) {
        setInputValue((previous) => previous + input);
      }
      return;
    }

    if (key.escape) {
      if (typeof onExit === 'function') onExit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((previous) => clamp(previous - 1, 0, Math.max(0, posts.length - 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((previous) => clamp(previous + 1, 0, Math.max(0, posts.length - 1)));
      return;
    }

    if (busy) return;

    const lower = String(input || '').toLowerCase();
    if (lower === 'r') { reload(); return; }
    if (lower === 'a') { setInputMode('add-title'); setInputValue(''); return; }
    if (lower === 'e' && selected) {
      void runAction(
        async () => runDexNotesCommand(['edit', '--slug', selected.slug]),
        `Edited ${selected.slug}`,
      );
      return;
    }
    if (lower === 't' && selected) { setInputMode('set-title'); setInputValue(selected.title || ''); return; }
    if (lower === 'b') {
      void runAction(async () => runDexNotesCommand(['build']), 'Dex Notes build complete.');
      return;
    }
    if (lower === 'v') {
      void runAction(async () => runDexNotesCommand(['validate']), 'Dex Notes validation passed.');
      return;
    }
  });

  const listWindow = computeWindow({
    total: posts.length,
    cursor: selectedIndex,
    height: Math.max(6, Math.min(16, height - 12)),
  });

  return React.createElement(Box, { flexDirection: 'column', width, height, minHeight: height },
    React.createElement(Text, { bold: true, color: '#d0d5df' }, 'Dex Notes Manager'),
    React.createElement(Text, { color: '#8f98a8' }, 'content/dexnotes/posts/*.md'),
    React.createElement(Box, { marginTop: 1, flexDirection: 'row', gap: 2 },
      React.createElement(Box, { flexDirection: 'column', minWidth: 54, width: Math.min(72, Math.floor(width * 0.62)) },
        React.createElement(Text, { color: '#8f98a8' }, 'Posts'),
        listWindow.start > 0 ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
        ...posts.slice(listWindow.start, listWindow.end).map((post, localIndex) => {
          const index = listWindow.start + localIndex;
          const line = `${post.slug}  ${post.published || '-'}  ${post.title || '-'}`;
          return React.createElement(Text, index === selectedIndex ? { key: `${post.slug}-${index}`, inverse: true } : { key: `${post.slug}-${index}`, color: '#d0d5df' }, line);
        }),
        !posts.length ? React.createElement(Text, { color: '#8f98a8' }, 'No Dex Notes posts yet.') : null,
        listWindow.end < posts.length ? React.createElement(Text, { color: '#6e7688' }, '…') : null,
      ),
      React.createElement(Box, { flexDirection: 'column', flexGrow: 1 },
        React.createElement(Text, { color: '#8f98a8' }, 'Details'),
        selected
          ? React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Text, {}, `Slug: ${selected.slug}`),
            React.createElement(Text, {}, `Published: ${selected.published || '-'}`),
            React.createElement(Text, {}, `Title: ${selected.title || '-'}`),
            React.createElement(Text, {}, `Excerpt: ${selected.excerpt || '-'}`),
          )
          : React.createElement(Text, { color: '#8f98a8' }, 'Select a post.'),
      ),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
      inputMode
        ? React.createElement(Text, { color: '#ffcc66' }, inputMode === 'add-title' ? `New post title: ${inputValue}` : `Set title: ${inputValue}`)
        : React.createElement(Text, { color: '#8f98a8' }, 'a add  e edit  t set title  b build  v validate  r reload  Esc back'),
      React.createElement(Text, { color: busy ? '#ffcc66' : '#a6e3a1' }, busy ? 'Working…' : statusLine),
    ),
    React.createElement(Text, { color: '#6e7688' }, 'Use $EDITOR for full markdown body edits.'),
  );
}
