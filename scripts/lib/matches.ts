import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { fetchHtml, MCA_ORIGIN, absolutize } from './http.js';
import { parseRoundPage } from './parsers/round-page.js';
import type { RoundPageT, TournamentPageT } from './schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MATCHES_DIR = path.join(ROOT, 'data', 'matches');

export interface RoundLink {
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

const QUERY_ROUND_LABEL: Record<string, string> = {
  round_1: '1st Round',
  round_2: '2nd Round',
  round_3: '3rd Round',
  round_4: '4th Round',
  round_5: '5th Round',
  round_6: '6th Round',
  pre_quarter: 'Pre-Quarter',
  quarter_final: 'Quarter Final',
  semi_final: 'Semi Final',
  final: 'Final',
  '3rd_place': '3rd Place',
  '5th_place': '5th Place',
  '7th_place': '7th Place',
  '5_8_place_qualifier': '5-8 Place Qualifier',
};

// Newer MCA results pages link rounds as "..._results.php?category=mens_singles&round=round_1".
function classifyQueryRoundLink(href: string): RoundLink | null {
  const u = new URL(href, MCA_ORIGIN);
  if (!u.pathname.endsWith('_results.php')) return null;
  const category = u.searchParams.get('category');
  const round = u.searchParams.get('round');
  if (!category || !round) return null;
  const categoryKey = category === 'mens_singles' ? 'men_singles' : category === 'womens_singles' ? 'women_singles' : null;
  if (!categoryKey) return null;
  return {
    url: u.toString(),
    categoryKey,
    roundKey: round,
    roundLabel: QUERY_ROUND_LABEL[round] ?? round,
  };
}

function classifyRoundLink(href: string): RoundLink | null {
  if (href.includes('_results.php?')) return classifyQueryRoundLink(href);
  // Match pattern like: ".../results/men_round_1" or "women_singles" etc.
  const m = /\/results\/([a-z0-9_]+)$/i.exec(href);
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

export function extractRoundLinks(html: string): RoundLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: RoundLink[] = [];
  $('a[href*="/results/"], a[href*="_results.php?"]').each((_, el) => {
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

export async function scrapeTournamentMatches(t: TournamentPageT): Promise<{ ok: number; miss: number; fail: number }> {
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
    fs.mkdirSync(MATCHES_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(MATCHES_DIR, `${t.slug}.json`),
      JSON.stringify({ tournamentSlug: t.slug, rounds: parsedRounds }, null, 2) + '\n',
    );
  }
  return { ok, miss, fail };
}
