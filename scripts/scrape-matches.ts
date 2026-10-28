import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeTournamentMatches } from './lib/matches.js';
import type { TournamentPageT } from './lib/schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const TOURNAMENTS_DIR = path.join(ROOT, 'data', 'tournaments');

function loadTournaments(): TournamentPageT[] {
  const files = fs.readdirSync(TOURNAMENTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(TOURNAMENTS_DIR, f), 'utf-8')) as TournamentPageT);
}

try {
  const all = loadTournaments();
  const tournaments = all.filter(t => t.hasResultsSubPage);
  console.log(`scraping match data for ${tournaments.length} tournaments (of ${all.length} total)`);
  let totOk = 0, totMiss = 0, totFail = 0;
  for (const [i, t] of tournaments.entries()) {
    console.log(`\n[${i + 1}/${tournaments.length}] ${t.slug}`);
    const r = await scrapeTournamentMatches(t);
    totOk += r.ok; totMiss += r.miss; totFail += r.fail;
    console.log(`   → ${r.ok} pages ok, ${r.miss} 404, ${r.fail} failed`);
  }
  console.log(`\ndone. total: ${totOk} ok, ${totMiss} 404, ${totFail} failed`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
