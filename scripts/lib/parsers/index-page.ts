import * as cheerio from 'cheerio';
import { collapseWs } from '../normalize.js';
import { TournamentIndexEntry, type TournamentIndexEntryT } from '../schemas.js';

const TOURNAMENT_URL_RE = /^(\d{4})_[^/]+\.php$/;

const NON_TOURNAMENT_SUFFIXES = [
  '_videos.php',
  '_umpires_seminar.php',
  '_umpires_and_officials.php',
  '_officials_and_umpires.php',
  '_election.php',
  '_of_mca.php',
  '_carrom_promotion.php',
  '_unveiling_ceremony.php',
  '_meeting_with_central_sports_minister_carrom_promotion.php',
];

function isTournamentLink(href: string): boolean {
  if (!TOURNAMENT_URL_RE.test(href)) return false;
  if (NON_TOURNAMENT_SUFFIXES.some(s => href.endsWith(s))) return false;
  return true;
}

export function parseTournamentIndex(html: string): TournamentIndexEntryT[] {
  const $ = cheerio.load(html);
  const seen = new Map<string, TournamentIndexEntryT>();

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!isTournamentLink(href)) return;
    if (seen.has(href)) return;
    const label = collapseWs($(el).text() || $(el).attr('title') || href);
    const m = TOURNAMENT_URL_RE.exec(href);
    const urlYear = m ? Number(m[1]) : 0;
    const entry: TournamentIndexEntryT = {
      pagePath: href,
      label: label || href,
      urlYear,
      seasonHint: null,
    };
    seen.set(href, TournamentIndexEntry.parse(entry));
  });

  return [...seen.values()].sort((a, b) => a.pagePath.localeCompare(b.pagePath));
}
