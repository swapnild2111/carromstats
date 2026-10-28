import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml, MCA_ORIGIN, absolutize } from './http.js';
import { parseSlamsPage } from './parsers/slams-page.js';
import type { TournamentPageT } from './schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SLAMS_DIR = path.join(ROOT, 'data', 'slams');

// Fetches `<slug>_slams.php` and writes data/slams/<slug>.json. Returns the slam count,
// or null when the tournament has no slams page.
export async function scrapeTournamentSlams(t: TournamentPageT): Promise<number | null> {
  let html: string | null;
  try {
    html = await fetchHtml(absolutize(MCA_ORIGIN, `${t.slug}_slams.php`));
  } catch (err) {
    console.error(`  FAIL slams ${t.slug}:`, (err as Error).message);
    return null;
  }
  if (!html) return null;
  const page = parseSlamsPage(html, t.slug);
  fs.mkdirSync(SLAMS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SLAMS_DIR, `${t.slug}.json`), JSON.stringify(page, null, 2) + '\n');
  return page.slams.length;
}
