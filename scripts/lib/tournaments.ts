import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TournamentPageT } from './schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TOURNAMENTS_DIR = path.join(ROOT, 'data', 'tournaments');

// The organizer only wants state ranking events. Several tournaments can run
// at once but not every one awards state ranking, so the title must say so.
// (Titles vary: "Maharashtra State Ranking Carrom Tournament", "State Ranking Tournament", ...)
export const REQUIRED_KEYWORD = 'State Ranking';

export function matchesKeyword(title: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(title).includes(norm(REQUIRED_KEYWORD));
}

export function writeTournament(t: TournamentPageT): void {
  fs.mkdirSync(TOURNAMENTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TOURNAMENTS_DIR, `${t.slug}.json`), JSON.stringify(t, null, 2) + '\n');
}

// Rebuild data/tournaments/_index.json from the per-tournament files on disk.
export function rebuildTournamentIndex(): number {
  fs.mkdirSync(TOURNAMENTS_DIR, { recursive: true });
  const files = fs.readdirSync(TOURNAMENTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const summary = files
    .map(f => JSON.parse(fs.readFileSync(path.join(TOURNAMENTS_DIR, f), 'utf-8')) as TournamentPageT)
    .map(r => ({
      slug: r.slug,
      title: r.title,
      season: r.season,
      date: r.date,
      venue: r.venue,
      categories: r.categories.map(c => c.key),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  fs.writeFileSync(path.join(TOURNAMENTS_DIR, '_index.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary.length;
}
