export function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeName(s: string): string {
  return collapseWs(s)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyPlayer(name: string, city: string | null): string {
  const base = normalizeName(name).replaceAll(' ', '-');
  const c = city ? '-' + normalizeName(city).replaceAll(' ', '-') : '';
  return (base + c).replaceAll(/-+/g, '-').replace(/^-|-$/g, '');
}

export function slugifyTournament(pagePath: string): string {
  return pagePath.replace(/\.php$/, '').replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

// Split a trailing "(…)" tail off a string using string indices — no backtracking regex.
// Returns [head, inside] where head has the "(…)" removed and inside is the parenthesized
// content (null if there is no trailing "(…)").
function splitTrailingParen(s: string): [string, string | null] {
  const trimmed = s.trim();
  if (!trimmed.endsWith(')')) return [trimmed, null];
  const open = trimmed.lastIndexOf('(');
  if (open < 0) return [trimmed, null];
  const inside = trimmed.slice(open + 1, -1);
  if (inside.includes('(') || inside.includes(')')) return [trimmed, null];
  return [trimmed.slice(0, open).trim(), inside.trim()];
}

// Extract "Name (City)" → { name, city }; if no parens, city is null.
export function parseNameCity(raw: string): { name: string; city: string | null } {
  const s = collapseWs(raw);
  const [head, inside] = splitTrailingParen(s);
  if (inside !== null) return { name: head, city: inside };
  return { name: s, city: null };
}

// Extract "Name, City (Affiliation)" → { name, city, affiliation }.
// Used by the points-table page which formats entries differently from tournament pages.
export function parsePointsPlayer(raw: string): { name: string; city: string | null; affiliation: string | null } {
  const s = collapseWs(raw);
  const [withoutAff, affiliation] = splitTrailingParen(s);
  const commaIdx = withoutAff.lastIndexOf(',');
  if (commaIdx < 0) return { name: withoutAff, city: null, affiliation };
  return {
    name: collapseWs(withoutAff.slice(0, commaIdx)),
    city: collapseWs(withoutAff.slice(commaIdx + 1)),
    affiliation,
  };
}

// Season logic: MCA season runs Jul–Jun. A tournament on 2026-07-04 is in "2026-27";
// one on 2026-05-15 would be "2025-26".
export function seasonFor(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1..12
  const startYear = m >= 7 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

export function seasonFromYearHint(year: number, month?: number): string {
  if (typeof month === 'number') {
    return seasonFor(new Date(Date.UTC(year, month - 1, 15)));
  }
  // URL year prefix alone is ambiguous; default to that year's Jul–Jun season.
  const endShort = String((year + 1) % 100).padStart(2, '0');
  return `${year}-${endShort}`;
}
