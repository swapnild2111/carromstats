import * as cheerio from 'cheerio';
import type { AnyNode, Cheerio, CheerioAPI } from 'cheerio';
import { collapseWs, parseNameCity } from '../normalize.js';
import { RoundPage, type RoundPageT } from '../schemas.js';

// A round page has a series of `.popScrolls` containers, one per match. Each contains:
//   #green_s (side1 name+city)
//   #red_s   (side2 name+city)
//   <table>  score grid (header row: S1 S2 S3 B S1 S2 S3, data row: <n> <n> <n> T <n> <n> <n>)

function parseScoreCell(s: string): number | null {
  const t = s.trim();
  if (!t || t === '-' || t === '—' || t === 'T') return null;
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

function decideWinner(s1: (number | null)[], s2: (number | null)[]): 'side1' | 'side2' | 'unknown' {
  let a = 0, b = 0;
  for (let i = 0; i < s1.length; i++) {
    const x = s1[i] ?? 0;
    const y = s2[i] ?? 0;
    if (x > y) a++;
    else if (y > x) b++;
  }
  if (a > b) return 'side1';
  if (b > a) return 'side2';
  return 'unknown';
}

function extractMatchFromContainer(
  container: Cheerio<AnyNode>,
  $: CheerioAPI,
): RoundPageT['matches'][number] | null {
  const green = container.find('#green_s').first();
  const red = container.find('#red_s').first();
  if (!green.length || !red.length) return null;
  const side1 = parseNameCity(collapseWs(green.text()));
  const side2 = parseNameCity(collapseWs(red.text()));
  if (!side1.name || !side2.name) return null;

  const table = container.find('table').first();
  if (!table.length) return null;
  const rows = table.find('tr');
  if (rows.length < 2) return null;
  const cells = rows.eq(1).find('td, th').map((_, c) => collapseWs($(c).text())).get();
  const tIdx = cells.indexOf('T');
  if (tIdx < 0) return null;
  const s1 = cells.slice(0, tIdx).map(parseScoreCell);
  const s2 = cells.slice(tIdx + 1).map(parseScoreCell);

  return {
    matchNo: null,
    side1: { name: side1.name, city: side1.city },
    side2: { name: side2.name, city: side2.city },
    side1Scores: s1,
    side2Scores: s2,
    winner: decideWinner(s1, s2),
  };
}

export function parseRoundPage(html: string, tournamentSlug: string, categoryKey: string, roundKey: string, roundLabel: string): RoundPageT {
  const $ = cheerio.load(html);
  const matches: RoundPageT['matches'] = [];

  $('.popScrolls').each((_, el) => {
    const match = extractMatchFromContainer($(el), $);
    if (match) matches.push(match);
  });

  const page: RoundPageT = {
    tournamentSlug,
    categoryKey,
    roundKey,
    roundLabel,
    matches,
  };
  return RoundPage.parse(page);
}
