import { fetchHtml, MCA_ORIGIN, absolutize } from './lib/http.js';
import { parseTournamentPage } from './lib/parsers/tournament-page.js';
import { scrapeTournamentMatches } from './lib/matches.js';
import { scrapeTournamentSlams } from './lib/slams.js';
import { matchesKeyword, REQUIRED_KEYWORD, rebuildTournamentIndex, writeTournament } from './lib/tournaments.js';

// Usage: npm run scrape-one -- <tournament page URL or path> [more...]
// Scrapes only the given tournament pages (+ their results sub-pages) into data/.
// Only tournaments whose title contains REQUIRED_KEYWORD are kept.
// Does not touch points or champions data.

function toPagePath(arg: string): string {
  const u = new URL(arg, MCA_ORIGIN);
  if (u.origin !== new URL(MCA_ORIGIN).origin) throw new Error(`not an MCA URL: ${arg}`);
  return u.pathname.replace(/^\/+/, '');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: npm run scrape-one -- <tournament page URL> [more URLs...]');
  process.exit(2);
}

let failed = 0;
for (const arg of args) {
  const pagePath = toPagePath(arg);
  console.log(`\n== ${pagePath} ==`);
  const html = await fetchHtml(absolutize(MCA_ORIGIN, pagePath));
  if (!html) {
    console.error('  404');
    failed++;
    continue;
  }
  const t = parseTournamentPage(html, pagePath);
  if (!matchesKeyword(t.title)) {
    console.error(`  SKIP: title "${t.title}" does not contain "${REQUIRED_KEYWORD}"`);
    failed++;
    continue;
  }
  writeTournament(t);
  console.log(`  ${t.title} | ${t.date ?? 'no date'} | ${t.venue ?? 'no venue'}`);
  console.log(`  categories: ${t.categories.map(c => `${c.key}:${c.top8.length}`).join(', ') || '(none)'}`);
  if (t.hasResultsSubPage) {
    const r = await scrapeTournamentMatches(t);
    console.log(`  match pages: ${r.ok} ok, ${r.miss} 404, ${r.fail} failed`);
    if (r.fail > 0) failed++;
  } else {
    console.log('  no results sub-page');
  }
  const slams = await scrapeTournamentSlams(t);
  console.log(slams === null ? '  no slams page' : `  slams: ${slams} entries`);
}
console.log(`\ntournament index: ${rebuildTournamentIndex()} tournaments`);
process.exit(failed ? 1 : 0);
