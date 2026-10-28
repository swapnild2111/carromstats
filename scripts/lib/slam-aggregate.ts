import { normalizeName } from './normalize.js';
import type { SlamsPageT } from './schemas.js';

export type Gender = 'male' | 'female';

export interface SlamTotals {
  white: number;
  black: number;
  total: number;
  byTournament: Record<string, { white: number; black: number }>;
}

export interface SlamLeaderRow {
  // Set when the slammer matches a known player record; null for players outside any top 8.
  slug: string | null;
  name: string;
  city: string | null;
  gender: Gender | null;
  white: number;
  black: number;
  total: number;
  tournaments: number;
}

export interface KnownPlayer {
  slug: string;
  gender: Gender | null;
  cities: string[];
}

// Slam pages print full names ("Aayush Bhushan Garud") while top-8 pages print
// "Aayush B Garud" or "Aayush Garud". First + last token is the stable common key.
export function firstLast(name: string): string {
  const parts = normalizeName(name).split(' ').filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

function genderOfCategory(key: string): Gender | null {
  if (key === 'women_singles') return 'female';
  if (key === 'men_singles') return 'male';
  return null;
}

export function aggregateSlams(
  pages: SlamsPageT[],
  knownByNames: Map<string, string[]>,       // firstLast(name) -> candidate slugs
  known: Map<string, KnownPlayer>,
): { bySlug: Map<string, SlamTotals>; leaders: SlamLeaderRow[]; ambiguous: string[] } {
  const bySlug = new Map<string, SlamTotals>();
  const others = new Map<string, SlamLeaderRow & { tset: Set<string>; cities: Set<string> }>();
  const matchedRows = new Map<string, SlamLeaderRow & { tset: Set<string> }>();
  const ambiguous = new Set<string>();

  const resolve = (name: string, city: string | null, gender: Gender | null): string | null => {
    const candidates = (knownByNames.get(firstLast(name)) ?? []).filter(slug => {
      const k = known.get(slug);
      // A men's slam can't belong to a player known from women's categories (and vice versa).
      return !(k && k.gender && gender && k.gender !== gender);
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      const c = city ? normalizeName(city) : '';
      const byCity = candidates.filter(slug => known.get(slug)?.cities.some(x => normalizeName(x) === c));
      if (byCity.length === 1) return byCity[0];
      ambiguous.add(`${name} (${city ?? '?'})`);
    }
    return null;
  };

  for (const page of pages) {
    for (const e of page.slams) {
      const gender = genderOfCategory(e.categoryKey);
      const slug = resolve(e.name, e.city, gender);
      if (slug) {
        let t = bySlug.get(slug);
        if (!t) { t = { white: 0, black: 0, total: 0, byTournament: {} }; bySlug.set(slug, t); }
        t[e.color]++;
        t.total++;
        const bt = (t.byTournament[page.tournamentSlug] ??= { white: 0, black: 0 });
        bt[e.color]++;
        const row = matchedRows.get(slug) ?? { slug, name: e.name, city: e.city, gender, white: 0, black: 0, total: 0, tournaments: 0, tset: new Set<string>() };
        row[e.color]++;
        row.total++;
        row.tset.add(page.tournamentSlug);
        // Prefer the longest printed name (full name) for display.
        if (e.name.length > row.name.length) row.name = e.name;
        matchedRows.set(slug, row);
      } else {
        const key = `${firstLast(e.name)}|${gender ?? ''}`;
        const row = others.get(key) ?? { slug: null, name: e.name, city: e.city, gender, white: 0, black: 0, total: 0, tournaments: 0, tset: new Set<string>(), cities: new Set<string>() };
        row[e.color]++;
        row.total++;
        row.tset.add(page.tournamentSlug);
        if (e.city) row.cities.add(e.city);
        if (e.name.length > row.name.length) row.name = e.name;
        others.set(key, row);
      }
    }
  }

  const leaders: SlamLeaderRow[] = [...matchedRows.values(), ...others.values()].map(r => ({
    slug: r.slug,
    name: r.name,
    city: r.city,
    gender: r.gender,
    white: r.white,
    black: r.black,
    total: r.total,
    tournaments: r.tset.size,
  }));
  leaders.sort((a, b) => b.total - a.total || b.tournaments - a.tournaments || a.name.localeCompare(b.name));
  return { bySlug, leaders, ambiguous: [...ambiguous].sort() };
}
