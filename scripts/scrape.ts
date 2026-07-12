import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml, MCA_ORIGIN, absolutize } from './lib/http.js';
import { parseTournamentIndex } from './lib/parsers/index-page.js';
import { parseTournamentPage } from './lib/parsers/tournament-page.js';
import { parsePointsPage } from './lib/parsers/points-page.js';
import { parseChampionsPage } from './lib/parsers/champions-page.js';
import type { TournamentPageT } from './lib/schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(rel: string, obj: unknown): void {
  const full = path.join(DATA_DIR, rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
}

async function scrapeIndex(): Promise<string[]> {
  console.log('== index ==');
  const html = await fetchHtml(new URL('index.php', MCA_ORIGIN).toString());
  if (!html) throw new Error('index.php not reachable');
  const entries = parseTournamentIndex(html);
  writeJson('tournaments/_source_index.json', entries);
  console.log(`  ${entries.length} tournament pages discovered`);
  return entries.map(e => e.pagePath);
}

async function scrapeTournaments(pagePaths: string[]): Promise<TournamentPageT[]> {
  console.log('== tournaments ==');
  const results: TournamentPageT[] = [];
  let ok = 0, missing = 0, failed = 0;
  for (const p of pagePaths) {
    const url = absolutize(MCA_ORIGIN, p);
    let html: string | null;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.error(`  FAIL fetch ${p}:`, (err as Error).message);
      failed++;
      continue;
    }
    if (!html) {
      console.warn(`  404 ${p}`);
      missing++;
      continue;
    }
    try {
      const parsed = parseTournamentPage(html, p);
      results.push(parsed);
      writeJson(`tournaments/${parsed.slug}.json`, parsed);
      ok++;
      const cats = parsed.categories.map(c => `${c.key}:${c.top8.length}`).join(', ');
      console.log(`  OK  ${parsed.slug} — ${cats || '(no categories)'}`);
    } catch (err) {
      console.error(`  FAIL parse ${p}:`, (err as Error).message);
      failed++;
    }
  }
  console.log(`\ntournaments: ${ok} ok, ${missing} 404, ${failed} failed`);

  const summary = results
    .map(r => ({
      slug: r.slug,
      title: r.title,
      season: r.season,
      date: r.date,
      venue: r.venue,
      categories: r.categories.map(c => c.key),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  writeJson('tournaments/_index.json', summary);
  return results;
}

async function scrapePoints(): Promise<void> {
  console.log('\n== points table ==');
  const html = await fetchHtml(new URL('players_points_table.php', MCA_ORIGIN).toString());
  if (!html) {
    console.warn('  points page missing (404)');
    return;
  }
  const parsed = parsePointsPage(html);
  parsed.fetchedAt = new Date().toISOString();
  writeJson('points/current.json', parsed);
  for (const cat of parsed.categories) {
    console.log(`  OK  ${cat.key}: ${cat.rows.length} rows, ${cat.tournamentHeaders.length} tournament columns`);
  }
}

const CHAMPIONS_PAGES = [
  // National
  'national_champions_senior_men.php',
  'national_champions_senior_women.php',
  'national_champions_veteran_men.php',
  'national_champions_veteran_women.php',
  'national_champions_youth_boys.php',
  'national_champions_youth_girls.php',
  'national_champions_junior_boys.php',
  'national_champions_junior_girls.php',
  'national_champions_sub_junior_boys.php',
  'national_champions_sub_junior_girls.php',
  'national_champions_cadet_boys.php',
  'national_champions_cadet_girls.php',
  // State
  'state_champions_senior_men.php',
  'state_champions_senior_women.php',
  'state_champions_veteran_men.php',
  'state_champions_veteran_women.php',
  'state_champions_youth_boys.php',
  'state_champions_youth_girls.php',
  'state_champions_junior_boys.php',
  'state_champions_junior_girls.php',
  'state_champions_sub_junior_boys.php',
  'state_champions_sub_junior_girls.php',
  'state_champions_cadet_boys.php',
  'state_champions_cadet_girls.php',
];

async function scrapeChampions(): Promise<void> {
  console.log('\n== champions ==');
  let ok = 0, missing = 0, failed = 0;
  for (const p of CHAMPIONS_PAGES) {
    const url = absolutize(MCA_ORIGIN, p);
    let html: string | null;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.error(`  FAIL fetch ${p}:`, (err as Error).message);
      failed++;
      continue;
    }
    if (!html) {
      console.warn(`  404 ${p}`);
      missing++;
      continue;
    }
    try {
      const parsed = parseChampionsPage(html, p);
      const slug = `${parsed.scope}_${parsed.categoryKey}`;
      writeJson(`champions/${slug}.json`, parsed);
      console.log(`  OK  ${slug}: ${parsed.champions.length} champions`);
      ok++;
    } catch (err) {
      console.error(`  FAIL parse ${p}:`, (err as Error).message);
      failed++;
    }
  }
  console.log(`\nchampions: ${ok} ok, ${missing} 404, ${failed} failed`);
}

try {
  ensureDir(DATA_DIR);
  const pagePaths = await scrapeIndex();
  await scrapeTournaments(pagePaths);
  await scrapePoints();
  await scrapeChampions();
  console.log('\ndone.');
} catch (err) {
  console.error(err);
  process.exit(1);
}
