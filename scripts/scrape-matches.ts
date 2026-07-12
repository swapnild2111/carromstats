import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { fetchHtml, MCA_ORIGIN, absolutize } from './lib/http.js';
import { parseRoundPage } from './lib/parsers/round-page.js';
import type { RoundPageT, TournamentPageT } from './lib/schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
const TOURNAMENTS_DIR = path.join(DATA_DIR, 'tournaments');
const MATCHES_DIR = path.join(DATA_DIR, 'matches');

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(full: string, obj: unknown): void {
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
}

function loadTournaments(): TournamentPageT[] {
  const files = fs.readdirSync(TOURNAMENTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(TOURNAMENTS_DIR, f), 'utf-8')) as TournamentPageT);
}

interface RoundLink {
  url: string;
  categoryKey: string;
  roundKey: string;
  roundLabel: string;
}

const ROUND_LABEL: Record<string, string> = {
  round_1: '1st Round',
  round_2: '2nd Round',
  round_3: '3rd Round',
  round_4: '4th Round',
  round_5: '5th Round',
  round_6: '6th Round',
  prequarter: 'Pre-Quarter',
  quarter: 'Quarter Final',
  singles: 'Final | Semi Final',
  position: 'Position',
};

function classifyRoundLink(href: string): RoundLink | null {
  // Match pattern like: ".../results/men_round_1" or "women_singles" etc.
  const m = /\/results\/([a-z_]+)$/i.exec(href);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  let categoryKey: string;
  let roundKey: string;
  if (kind.startsWith('men_')) {
    categoryKey = 'men_singles';
    roundKey = kind.slice(4);
  } else if (kind.startsWith('women_')) {
    categoryKey = 'women_singles';
    roundKey = kind.slice(6);
  } else {
    return null;
  }
  const roundLabel = ROUND_LABEL[roundKey] ?? roundKey;
  return {
    url: absolutize(MCA_ORIGIN, href) + '.php',  // MCA links omit the .php suffix
    categoryKey,
    roundKey,
    roundLabel,
  };
}

function extractRoundLinks(html: string): RoundLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: RoundLink[] = [];
  $('a[href*="/results/"]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href) return;
    const info = classifyRoundLink(href);
    if (!info) return;
    if (seen.has(info.url)) return;
    seen.add(info.url);
    out.push(info);
  });
  return out;
}

async function scrapeOneTournament(t: TournamentPageT): Promise<{ ok: number; miss: number; fail: number }> {
  if (!t.hasResultsSubPage) return { ok: 0, miss: 0, fail: 0 };
  const resultsUrl = absolutize(MCA_ORIGIN, `${t.slug}_results.php`);
  let indexHtml: string | null;
  try {
    indexHtml = await fetchHtml(resultsUrl);
  } catch (err) {
    console.error(`  FAIL results-index ${t.slug}:`, (err as Error).message);
    return { ok: 0, miss: 0, fail: 1 };
  }
  if (!indexHtml) {
    return { ok: 0, miss: 1, fail: 0 };
  }
  const links = extractRoundLinks(indexHtml);
  if (links.length === 0) return { ok: 0, miss: 0, fail: 0 };

  const parsedRounds: RoundPageT[] = [];
  let ok = 0, miss = 0, fail = 0;
  for (const l of links) {
    let html: string | null;
    try {
      html = await fetchHtml(l.url);
    } catch (err) {
      console.error(`    FAIL ${l.url}:`, (err as Error).message);
      fail++;
      continue;
    }
    if (!html) { miss++; continue; }
    try {
      const round = parseRoundPage(html, t.slug, l.categoryKey, l.roundKey, l.roundLabel);
      if (round.matches.length > 0) parsedRounds.push(round);
      ok++;
    } catch (err) {
      console.error(`    FAIL parse ${l.url}:`, (err as Error).message);
      fail++;
    }
  }

  if (parsedRounds.length > 0) {
    writeJson(path.join(MATCHES_DIR, `${t.slug}.json`), { tournamentSlug: t.slug, rounds: parsedRounds });
  }
  return { ok, miss, fail };
}

try {
  ensureDir(MATCHES_DIR);
  const tournaments = loadTournaments().filter(t => t.hasResultsSubPage);
  console.log(`scraping match data for ${tournaments.length} tournaments (of ${loadTournaments().length} total)`);
  let totOk = 0, totMiss = 0, totFail = 0;
  for (const [i, t] of tournaments.entries()) {
    console.log(`\n[${i + 1}/${tournaments.length}] ${t.slug}`);
    const r = await scrapeOneTournament(t);
    totOk += r.ok; totMiss += r.miss; totFail += r.fail;
    console.log(`   → ${r.ok} pages ok, ${r.miss} 404, ${r.fail} failed`);
  }
  console.log(`\ndone. total: ${totOk} ok, ${totMiss} 404, ${totFail} failed`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
