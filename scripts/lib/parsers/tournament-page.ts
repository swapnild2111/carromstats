import * as cheerio from 'cheerio';
import type { AnyNode, Cheerio, CheerioAPI } from 'cheerio';
import { collapseWs, parseNameCity, seasonFor, seasonFromYearHint, slugifyTournament } from '../normalize.js';
import { TournamentPage, type TournamentPageT } from '../schemas.js';

// Order matters: more specific patterns first so e.g. "women", "sub-junior", "veteran"
// are not swallowed by broader ones. MCA uses two shapes:
//   Ranking events:  "MEN SINGLE'S WINNERS", "WOMEN SINGLE'S WINNERS"
//   Championships:   "SUB-JUNIOR ( U - 14 ): BOYS SINGLES", "MEN TEAM CHAMPIONSHIP WINNERS"
// Each pattern is anchored at the start of the trimmed heading.
// Word boundaries around "men" so it doesn't match inside "women". Women variants
// listed before men variants for extra defense. Team categories exist on state-championship
// pages but the "players" are city names — we still capture them so the site can note them,
// though the aggregator will treat them as non-player entries.
const CATEGORY_HEADINGS: Array<{ re: RegExp; key: string; label: string }> = [
  { re: /^cadet\b.*boys?/i, key: 'cadet_boys', label: 'Cadet Boys' },
  { re: /^cadet\b.*girls?/i, key: 'cadet_girls', label: 'Cadet Girls' },
  { re: /^sub.?junior\b.*boys?/i, key: 'sub_junior_boys', label: 'Sub-Junior Boys' },
  { re: /^sub.?junior\b.*girls?/i, key: 'sub_junior_girls', label: 'Sub-Junior Girls' },
  { re: /^veteran\b.*\bwomen\b.*(?:single|winner|champion)/i, key: 'veteran_women', label: 'Veteran Women' },
  { re: /^veteran\b.*\bmen\b.*(?:single|winner|champion)/i, key: 'veteran_men', label: 'Veteran Men' },
  { re: /^junior\b.*boys?/i, key: 'junior_boys', label: 'Junior Boys' },
  { re: /^junior\b.*girls?/i, key: 'junior_girls', label: 'Junior Girls' },
  { re: /^youth\b.*boys?/i, key: 'youth_boys', label: 'Youth Boys' },
  { re: /^youth\b.*girls?/i, key: 'youth_girls', label: 'Youth Girls' },
  { re: /^\bwomen\b.*team.*(?:champion|winner)/i, key: 'women_team', label: 'Women Team' },
  { re: /^\bmen\b.*team.*(?:champion|winner)/i, key: 'men_team', label: 'Men Team' },
  { re: /^\bwomen\b.*single/i, key: 'women_singles', label: "Women's Singles" },
  { re: /^\bmen\b.*single/i, key: 'men_singles', label: "Men's Singles" },
];

function categoryFor(heading: string): { key: string; label: string } | null {
  for (const c of CATEGORY_HEADINGS) if (c.re.test(heading)) return { key: c.key, label: c.label };
  return null;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const ORD = '(?:st|nd|rd|th)?';
const DATE_RANGE_RE = new RegExp(
  String.raw`(\d{1,2})` + ORD + String.raw`\s*(?:to|-|–)\s*(\d{1,2})` + ORD + String.raw`\s+(\w+)[\s,]+(\d{4})`,
  'i',
);
const DATE_SINGLE_RE = new RegExp(
  String.raw`(\d{1,2})` + ORD + String.raw`\s+(\w+)[\s,]+(\d{4})`,
);

function parseDate(text: string): { iso: string | null; year: number | null; month: number | null } {
  const t = text.replace(/\s+/g, ' ');
  const range = DATE_RANGE_RE.exec(t);
  let startDay: number, monthName: string, year: number;
  if (range) {
    startDay = Number(range[1]);
    monthName = range[3];
    year = Number(range[4]);
  } else {
    const single = DATE_SINGLE_RE.exec(t);
    if (!single) return { iso: null, year: null, month: null };
    startDay = Number(single[1]);
    monthName = single[2];
    year = Number(single[3]);
  }
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return { iso: null, year, month: null };
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  return { iso, year, month };
}

function extractTitle($: CheerioAPI): string {
  const h2 = $('h2').first();
  if (h2.length) return collapseWs(h2.text());
  return collapseWs($('title').text());
}

const VENUE_RE = /(Hotel|Club|Gymkhana|Sabhagruha|Hall|Ground|Stadium|Auditorium|Bhavan|Society|Mandal|School|College)[^,.]{2,80}/i;

function extractVenue($: CheerioAPI): string | null {
  const heroText = collapseWs($('.contain, .featur, section').first().text());
  const m = VENUE_RE.exec(heroText);
  return m ? collapseWs(m[0]) : null;
}

function extractTopEight($: CheerioAPI, sectionHeading: Cheerio<AnyNode>): Array<{ position: number; name: string; city: string | null }> {
  // Section cards contain a table with rank+photo cards; each card has an <img alt="Name (City)"> and ordinal text nearby.
  // Approach: find the containing wrapper for this heading and collect <img alt> in document order.
  const container = sectionHeading.closest('.col-lg-6, .col-md-6, .row').first();
  const entries: Array<{ position: number; name: string; city: string | null }> = [];
  container.find('img[alt]').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    if (!alt || alt.length > 100) return;
    // Skip images that clearly aren't players (icons, logos)
    if (/^(logo|icon|photo|image|carrom|trophy|medal)$/i.test(alt)) return;
    const { name, city } = parseNameCity(alt);
    if (name.split(' ').length < 2) return; // require at least 2 tokens (first + last name)
    entries.push({ position: entries.length + 1, name, city });
  });
  return entries.slice(0, 8);
}

const SEASON_IN_TITLE_RE = /(\d{4})[\s-]+(\d{2,4})/;

function extractSeason(title: string, urlYear: number, dateIso: string | null): string {
  const m = SEASON_IN_TITLE_RE.exec(title);
  if (m) {
    const start = Number(m[1]);
    const endRaw = Number(m[2]);
    const end = endRaw < 100 ? (Math.floor(start / 100) * 100 + endRaw) : endRaw;
    if (end === start + 1) {
      return `${start}-${String(end % 100).padStart(2, '0')}`;
    }
  }
  if (dateIso) return seasonFor(dateIso);
  return seasonFromYearHint(urlYear);
}

export function parseTournamentPage(html: string, pagePath: string): TournamentPageT {
  const $ = cheerio.load(html);

  const title = extractTitle($);
  const bodyText = collapseWs($('body').text());
  const dateInfo = parseDate(bodyText);
  const venue = extractVenue($);
  const urlYearMatch = /^(\d{4})_/.exec(pagePath);
  const urlYear = urlYearMatch ? Number(urlYearMatch[1]) : 0;

  const season = extractSeason(title, urlYear, dateInfo.iso);

  const categories: TournamentPageT['categories'] = [];
  $('h5').each((_, el) => {
    const text = collapseWs($(el).text());
    const cat = categoryFor(text);
    if (!cat) return;
    const top8 = extractTopEight($, $(el));
    if (top8.length === 0) return;
    if (categories.some(c => c.key === cat.key)) return;
    categories.push({ key: cat.key, label: cat.label, top8 });
  });

  // Detect linked results sub-page (indicates match-level data available)
  const hasResultsSubPage = $(`a[href*="_results.php"]`).length > 0;

  const result: TournamentPageT = {
    slug: slugifyTournament(pagePath),
    pagePath,
    title: title || pagePath,
    urlYear,
    season,
    date: dateInfo.iso,
    venue,
    hasResultsSubPage,
    categories,
  };
  return TournamentPage.parse(result);
}
