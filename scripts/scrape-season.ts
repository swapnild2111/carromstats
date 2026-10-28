import { fetchHtml, MCA_ORIGIN, absolutize } from './lib/http.js';
import { parseTournamentIndex } from './lib/parsers/index-page.js';
import { parseTournamentPage } from './lib/parsers/tournament-page.js';
import { scrapeTournamentMatches } from './lib/matches.js';
import { scrapeTournamentSlams } from './lib/slams.js';
import { matchesKeyword, REQUIRED_KEYWORD, rebuildTournamentIndex, writeTournament } from './lib/tournaments.js';

// Usage: npm run scrape-season -- 2025-26
// Scrapes every tournament in the given season whose title contains REQUIRED_KEYWORD.
// A season "2025-26" can have URLs dated 2025 or 2026, so both years are candidates.

const season = process.argv[2];
const m = /^(\d{4})-(\d{2})$/.exec(season ?? '');
if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) {
  console.error('usage: npm run scrape-season -- <season, e.g. 2025-26>');
  process.exit(2);
}
const startYear = Number(m[1]);

const indexHtml = await fetchHtml(new URL('index.php', MCA_ORIGIN).toString());
if (!indexHtml) throw new Error('index.php not reachable');
const candidates = parseTournamentIndex(indexHtml).filter(e => e.urlYear === startYear || e.urlYear === startYear + 1);
console.log(`${candidates.length} candidate pages with URL year ${startYear}/${startYear + 1}`);

const kept: ReturnType<typeof parseTournamentPage>[] = [];
const skipped: string[] = [];
for (const [i, c] of candidates.entries()) {
  let html: string | null;
  try {
    html = await fetchHtml(absolutize(MCA_ORIGIN, c.pagePath));
  } catch (err) {
    skipped.push(`${c.pagePath} — fetch failed: ${(err as Error).message}`);
    continue;
  }
  if (!html) { skipped.push(`${c.pagePath} — 404`); continue; }
  const t = parseTournamentPage(html, c.pagePath);
  if (t.season !== season) { skipped.push(`${c.pagePath} — season ${t.season}`); continue; }
  if (!matchesKeyword(t.title)) { skipped.push(`${c.pagePath} — title lacks keyword: "${t.title}"`); continue; }
  console.log(`[${i + 1}/${candidates.length}] KEEP ${t.slug} | ${t.date ?? 'no date'} | ${t.categories.map(x => `${x.key}:${x.top8.length}`).join(', ') || '(no categories)'}${t.hasResultsSubPage ? '' : ' | no results page'}`);
  writeTournament(t);
  kept.push(t);
}

console.log(`\n== matches for ${kept.length} tournaments ==`);
let failed = 0;
for (const [i, t] of kept.entries()) {
  console.log(`[${i + 1}/${kept.length}] ${t.slug}`);
  const r = await scrapeTournamentMatches(t);
  console.log(`   → ${r.ok} ok, ${r.miss} 404, ${r.fail} failed`);
  failed += r.fail;
  const slams = await scrapeTournamentSlams(t);
  console.log(slams === null ? '   slams: none' : `   slams: ${slams} entries`);
}

console.log(`\nkept ${kept.length}, skipped ${skipped.length} (keyword: "${REQUIRED_KEYWORD}", season: ${season})`);
for (const s of skipped) console.log(`  skipped: ${s}`);
console.log(`tournament index: ${rebuildTournamentIndex()} tournaments`);
process.exit(failed ? 1 : 0);
