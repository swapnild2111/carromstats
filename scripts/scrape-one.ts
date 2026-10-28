import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml, MCA_ORIGIN, absolutize } from './lib/http.js';
import { parseTournamentPage } from './lib/parsers/tournament-page.js';
import { scrapeTournamentMatches } from './lib/matches.js';

// Usage: npm run scrape-one -- <tournament page URL or path> [more...]
// Scrapes only the given tournament pages (+ their results sub-pages) into data/.
// Does not touch the index, points or champions data.

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const TOURNAMENTS_DIR = path.join(ROOT, 'data', 'tournaments');

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
fs.mkdirSync(TOURNAMENTS_DIR, { recursive: true });
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
  fs.writeFileSync(path.join(TOURNAMENTS_DIR, `${t.slug}.json`), JSON.stringify(t, null, 2) + '\n');
  console.log(`  ${t.title} | ${t.date ?? 'no date'} | ${t.venue ?? 'no venue'}`);
  console.log(`  categories: ${t.categories.map(c => `${c.key}:${c.top8.length}`).join(', ') || '(none)'}`);
  if (t.hasResultsSubPage) {
    const r = await scrapeTournamentMatches(t);
    console.log(`  match pages: ${r.ok} ok, ${r.miss} 404, ${r.fail} failed`);
    if (r.fail > 0) failed++;
  } else {
    console.log('  no results sub-page');
  }
}
process.exit(failed ? 1 : 0);
