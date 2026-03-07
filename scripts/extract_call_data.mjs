#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { load } from 'cheerio';

const ROOT = process.cwd();
const SOURCE_PATH = path.join(ROOT, 'docs', 'call', 'index.html');
const OUT_PATH = path.join(ROOT, 'public', 'data', 'call.data.json');

function collapse(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function firstMatching(lines, matcher) {
  return lines.find((line) => matcher(line)) || '';
}

function ensure(value, label) {
  if (!value) {
    throw new Error(`Unable to extract required field: ${label}`);
  }
  return value;
}

function getImage($section) {
  const $img = $section.find('img').first();
  if (!$img.length) return '';
  return collapse($img.attr('src') || $img.attr('data-src') || $img.attr('data-image') || '');
}

function extractLinks($, $section) {
  const links = [];
  $section.find('a[href]').each((_, anchor) => {
    const $anchor = $(anchor);
    const href = collapse($anchor.attr('href') || '');
    const label = collapse($anchor.text());
    if (!href || !label) return;
    links.push({ label_raw: label, href });
  });
  return links;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readExistingModel() {
  if (!fs.existsSync(OUT_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    if (parsed?.hero?.heading_raw && Array.isArray(parsed?.lanes) && parsed.lanes.length >= 4) {
      return parsed;
    }
  } catch {
    // Ignore malformed model; caller will handle fallback.
  }
  return null;
}

function extractFromHtml(html, sourceLabel) {
  const $ = load(html, { decodeEntities: false });
  const $main = $('main#page').first();
  if (!$main.length) {
    throw new Error('Missing <main id="page">');
  }

  const sections = $main.find('section.page-section').toArray().map((node) => $(node));
  if (sections.length < 6) {
    throw new Error(`Expected at least 6 call sections, found ${sections.length}`);
  }

  const s1 = sections[0];
  const s2 = sections[1];
  const s3 = sections[2];
  const s4 = sections[3];
  const s5 = sections[4];
  const s6 = sections[5];

  function sectionLines($section) {
    const out = [];
    $section.find('h1, h2, h3, h4, p, li p').each((_, node) => {
      const line = collapse($(node).text());
      if (!line) return;
      if (out.includes(line)) return;
      out.push(line);
    });
    return out;
  }

  const s1Lines = sectionLines(s1);
  const s2Lines = sectionLines(s2);
  const s3Lines = sectionLines(s3);
  const s4Lines = sectionLines(s4);
  const s5Lines = sectionLines(s5);
  const s6Lines = sectionLines(s6);

  const laneA = ensure(firstMatching(s1Lines, (line) => line.startsWith('This category includes commissioned recordings')), 'lane A description');
  const laneB = ensure(firstMatching(s1Lines, (line) => line.startsWith('This category is for when we need someone to cull')), 'lane B description');
  const laneC = ensure(firstMatching(s1Lines, (line) => line.startsWith('This is for community feedback!')), 'lane C description');
  const laneMini = ensure(firstMatching(s1Lines, (line) => line.startsWith('Mini-dex calls are quick one-off volunteer calls')), 'mini lane description');

  const statusLabel = ensure(collapse(s2.find('h1, h2, h3, h4, p.sqsrte-large').first().text()), 'status label');
  const cycleLabel = ensure(firstMatching(s2Lines, (line) => /^IN DEX A\d{4}\.\d/.test(line)), 'status cycle');
  const callTitle = ensure(firstMatching(s2Lines, (line) => line.toLowerCase().includes('general artist')), 'call title');
  const deadlineLabel = ensure(firstMatching(s2Lines, (line) => /DEADLINE/.test(line) && !line.includes('•')), 'deadline label');
  const notificationLabel = ensure(firstMatching(s2Lines, (line) => /NOTIFICATION BY/.test(line) && !line.includes('•')), 'notification label');
  const activeSummary = ensure(firstMatching(s2Lines, (line) => line.startsWith('a quick call for collaboration')), 'active summary');
  const activeStructure = ensure(firstMatching(s2Lines, (line) => line.startsWith('this call is structured into three separate subcalls')), 'active structure');

  const activeSubmit = extractLinks($, s2).find((link) => /SUUBMIT|SUBMIT/.test(link.label_raw));
  if (!activeSubmit) {
    throw new Error('Missing active call submit link');
  }

  const relatedLinks = extractLinks($, s3);

  function collectSubcall(titlePrefix) {
    const start = s3Lines.findIndex((line) => line.startsWith(titlePrefix));
    if (start < 0) return null;
    const item = {
      heading_raw: s3Lines[start],
      body_raw: [],
    };
    for (let i = start + 1; i < s3Lines.length; i += 1) {
      const line = s3Lines[i];
      if (/^IN DEX A2024\.4[abc]:/.test(line) || line === 'RELATED LINKS') break;
      item.body_raw.push(line);
    }
    return item;
  }

  const subcallA = collectSubcall('IN DEX A2024.4a:');
  const subcallB = collectSubcall('IN DEX A2024.4b:');
  const subcallC = collectSubcall('IN DEX A2024.4c:');

  if (!subcallA || !subcallB || !subcallC) {
    throw new Error('Missing one or more A2024.4 subcall blocks');
  }

  const miniLabel = ensure(collapse(s4.find('h1, h2, h3, h4, p.sqsrte-large').first().text()), 'mini status label');
  const miniCycle = ensure(firstMatching(s4Lines, (line) => line.startsWith('MINI-DEX')), 'mini cycle');
  const miniSubmit = extractLinks($, s4).find((link) => /SUBMIT/.test(link.label_raw));
  if (!miniSubmit) {
    throw new Error('Missing mini-dex submit link');
  }

  const requirementsHeading = ensure(firstMatching(s5Lines, (line) => line.startsWith('THE ONLY REQUIREEMENTS')), 'requirements heading');
  const requirementsItems = [];
  for (const line of s5Lines) {
    if (line === requirementsHeading) continue;
    if (line.startsWith('if you have any questions')) continue;
    if (requirementsItems.includes(line)) continue;
    requirementsItems.push(line);
  }

  const requirementsContact = ensure(firstMatching(s5Lines, (line) => line.startsWith('if you have any questions')), 'requirements contact');
  const requirementsLinks = extractLinks($, s5);
  const ccLink = requirementsLinks.find((link) => link.label_raw === 'here');
  const emailLink = requirementsLinks.find((link) => link.href.startsWith('mailto:'));

  if (!ccLink || !emailLink) {
    throw new Error('Missing requirements support links');
  }

  const pastHeadingLines = [
    ensure(firstMatching(s6Lines, (line) => line.startsWith('PASST IN DEX')), 'past heading line 1'),
    ensure(firstMatching(s6Lines, (line) => line.startsWith('CALL')), 'past heading line 2'),
    ensure(firstMatching(s6Lines, (line) => line.startsWith('CCOL')), 'past heading line 3'),
  ];

  const pastA2024 = {
    cycle_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('IN DEX A2024.3')), 'past A2024 cycle'),
    prompt_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('call for generative video animations')), 'past A2024 prompt'),
    outcome_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('selected animation:')), 'past A2024 outcome'),
    date_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('MAR 2024 - APR 2024')), 'past A2024 date'),
  };

  const pastA2023 = {
    cycle_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('IN DEX A2023.1')), 'past A2023 cycle'),
    prompt_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('call for proposals for a commissioned audiovisual recording')), 'past A2023 prompt'),
    outcome_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('selected proposals:')), 'past A2023 outcome'),
    date_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('DEC 2022 - JAN 31 2023')), 'past A2023 date'),
  };

  const pastLinks = extractLinks($, s6);
  const spotlightLink = pastLinks.find((link) => link.label_raw === 'Arlo Tomecek');
  const privacyLink = pastLinks.find((link) => /privacy/i.test(link.label_raw));

  if (!spotlightLink || !privacyLink) {
    throw new Error('Missing past/newsletter links');
  }

  const yearMatch = cycleLabel.match(/20\d{2}/);
  const monthDayMatch = deadlineLabel.match(/(\d{1,2})\/(\d{1,2})/);
  let deadlineIso = '';
  if (yearMatch && monthDayMatch) {
    const yyyy = yearMatch[0];
    const mm = monthDayMatch[1].padStart(2, '0');
    const dd = monthDayMatch[2].padStart(2, '0');
    deadlineIso = `${yyyy}-${mm}-${dd}`;
  }

  return {
    source: sourceLabel,
    generated_at: new Date().toISOString(),
    hero: {
      heading_raw: ensure(collapse(s1.find('h1, h2, h3, h4, p.sqsrte-large').first().text()), 'hero heading'),
      subtitle_raw: ensure(firstMatching(s1Lines, (line) => line.startsWith('your way to join the library collection')), 'hero subtitle'),
      credit_raw: ensure(firstMatching(s1Lines, (line) => line.startsWith('submission from')), 'hero credit'),
      framing_raw: ensure(firstMatching(s1Lines, (line) => line.startsWith('what it is: throughout the year')), 'hero framing'),
      categories_intro_raw: ensure(firstMatching(s1Lines, (line) => line.startsWith('they are sorted into four categories')), 'hero categories intro'),
      image_src: getImage(s1),
    },
    lanes: [
      { code_raw: 'IN DEX A', body_raw: laneA },
      { code_raw: 'IN DEX B', body_raw: laneB },
      { code_raw: 'IN DEX C', body_raw: laneC },
      { code_raw: 'MINI-DEX', body_raw: laneMini },
    ],
    active_call: {
      status_label_raw: statusLabel,
      cycle_raw: cycleLabel,
      title_raw: callTitle,
      deadline_label_raw: deadlineLabel,
      notification_label_raw: notificationLabel,
      deadline_iso: deadlineIso,
      structure_raw: activeStructure,
      summary_raw: activeSummary,
      submit_cta: activeSubmit,
      image_src: getImage(s2),
      related_heading_raw: ensure(firstMatching(s3Lines, (line) => line === 'RELATED LINKS'), 'related links heading'),
      subcalls: [subcallA, subcallB, subcallC],
      related_links: relatedLinks,
      related_note_raw: firstMatching(s3Lines, (line) => line.startsWith('battaglia trelia duo')),
      subcalls_image_src: getImage(s3),
    },
    mini_call: {
      status_label_raw: miniLabel,
      cycle_raw: miniCycle,
      body_raw: s4Lines.filter((line) => line !== miniCycle && line !== miniLabel),
      submit_cta: miniSubmit,
      image_src: getImage(s4),
    },
    requirements: {
      heading_raw: requirementsHeading,
      items_raw: requirementsItems,
      cc_link: ccLink,
      contact_raw: requirementsContact,
      contact_link: emailLink,
    },
    past_calls: {
      heading_lines_raw: pastHeadingLines,
      entries: [pastA2024, pastA2023],
      spotlight_link: spotlightLink,
      image_src: getImage(s6),
    },
    newsletter: {
      prompt_raw: ensure(firstMatching(s6Lines, (line) => line.startsWith('sign up for our newsletter')), 'newsletter prompt'),
      privacy_link: privacyLink,
      thanks_raw: ensure(firstMatching(s6Lines, (line) => line === 'thank you!'), 'newsletter thanks'),
    },
  };
}

function main() {
  let model = null;
  const causes = [];

  if (fs.existsSync(SOURCE_PATH)) {
    const html = fs.readFileSync(SOURCE_PATH, 'utf8');
    try {
      model = extractFromHtml(html, 'local-call-html');
    } catch (error) {
      causes.push(`local-call-html: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!model) {
    try {
      const headHtml = execSync('git show HEAD:docs/call/index.html', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      model = extractFromHtml(headHtml, 'git-head-call-html');
    } catch (error) {
      causes.push(`git-head-call-html: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!model) {
    const existing = readExistingModel();
    if (!existing) {
      throw new Error(`Unable to derive call data from local html, git HEAD snapshot, or existing canonical data. Causes: ${causes.join(' | ')}`);
    }
    model = {
      ...existing,
      source: 'existing-call-data-json',
      generated_at: new Date().toISOString(),
    };
  }

  writeJson(OUT_PATH, model);
  console.log(`call:extract wrote ${path.relative(ROOT, OUT_PATH)}`);
}

try {
  main();
} catch (error) {
  console.error(`call:extract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
