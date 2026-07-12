import * as cheerio from 'cheerio';
import type { AnyNode, Cheerio, CheerioAPI } from 'cheerio';
import { collapseWs } from '../normalize.js';
import { ChampionsPage, type ChampionsPageT } from '../schemas.js';

function categoryFromPath(pagePath: string): { key: string; label: string; scope: 'national' | 'state' } {
  const path = pagePath.toLowerCase();
  const scope: 'national' | 'state' = path.includes('national_champions_') ? 'national' : 'state';
  const raw = path
    .replace(/^national_champions_/, '')
    .replace(/^state_champions_/, '')
    .replace(/\.php$/, '');
  const label = raw
    .split('_')
    .map(t => t.charAt(0).toUpperCase() + t.slice(1))
    .join(' ')
    .replace(/Sub Junior/i, 'Sub-Junior');
  return { key: raw, label, scope };
}

function extractYears(text: string): number[] {
  const matches = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)];
  return matches.map(m => Number.parseInt(m[0], 10));
}

function parseChampionCard(card: Cheerio<AnyNode>): { name: string; affiliation: string | null; years: number[] } | null {
  // MCA cards use structural classes:
  //   .photoName (name)
  //   .photoDesi (affiliation/city)
  //   .photoName (years)
  const nameNodes = card.find('.photoName');
  const desiNode = card.find('.photoDesi').first();
  if (nameNodes.length < 1) return null;

  const name = collapseWs(nameNodes.eq(0).text());
  const affiliation = desiNode.length ? collapseWs(desiNode.text()) || null : null;

  // Years are in the second .photoName (or later ones).
  let yearsText = '';
  nameNodes.each((i, el) => {
    if (i === 0) return;
    yearsText += ' ' + cheerio.load('<x>' + (nameNodes.eq(i).text() ?? '') + '</x>').root().text();
  });
  const years = extractYears(yearsText);
  if (!name || years.length === 0) return null;
  return { name, affiliation, years };
}

function findChampionCards($: CheerioAPI): Array<Cheerio<AnyNode>> {
  const out: Array<Cheerio<AnyNode>> = [];
  $('.photoName').each((_, el) => {
    const card = $(el).closest('.col-lg-6, .col-lg-4, .col-lg-3, .col-md-6, .col-md-4');
    if (!card.length) return;
    // Skip if we've already seen this card
    if (out.some(c => c.get(0) === card.get(0))) return;
    out.push(card);
  });
  return out;
}

export function parseChampionsPage(html: string, pagePath: string): ChampionsPageT {
  const $ = cheerio.load(html);
  const cat = categoryFromPath(pagePath);
  const cards = findChampionCards($);
  const seen = new Set<string>();
  const champions: ChampionsPageT['champions'] = [];

  for (const card of cards) {
    const parsed = parseChampionCard(card);
    if (!parsed) continue;
    const key = parsed.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    champions.push(parsed);
  }

  const page: ChampionsPageT = {
    categoryKey: cat.key,
    categoryLabel: cat.label,
    scope: cat.scope,
    champions,
  };
  return ChampionsPage.parse(page);
}
