import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugifyPlayer, normalizeName } from './lib/normalize.js';
import type { TournamentPageT, PointsSnapshotT, ChampionsPageT, RoundPageT } from './lib/schemas.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
const TOURNAMENTS_DIR = path.join(DATA_DIR, 'tournaments');
const CHAMPIONS_DIR = path.join(DATA_DIR, 'champions');
const MATCHES_DIR = path.join(DATA_DIR, 'matches');
const POINTS_PATH = path.join(DATA_DIR, 'points', 'current.json');
const PLAYERS_DIR = path.join(DATA_DIR, 'players');
const ALIASES_PATH = path.join(DATA_DIR, 'aliases.json');

// Categories that contain city/team names rather than individual players.
const TEAM_CATEGORIES = new Set(['men_team', 'women_team']);

const CATEGORY_LABELS: Record<string, string> = {
  men_singles: "Men's Singles",
  women_singles: "Women's Singles",
  veteran_men: 'Veteran Men',
  veteran_women: 'Veteran Women',
  junior_boys: 'Junior Boys',
  junior_girls: 'Junior Girls',
  sub_junior_boys: 'Sub-Junior Boys',
  sub_junior_girls: 'Sub-Junior Girls',
  cadet_boys: 'Cadet Boys',
  cadet_girls: 'Cadet Girls',
  youth_boys: 'Youth Boys',
  youth_girls: 'Youth Girls',
};

interface Aliases {
  // Map from normalized "name|city" fingerprint → canonical slug.
  variantToCanonical: Record<string, string>;
}

function loadAliases(): Aliases {
  if (!fs.existsSync(ALIASES_PATH)) return { variantToCanonical: {} };
  const raw = fs.readFileSync(ALIASES_PATH, 'utf-8').trim();
  if (!raw) return { variantToCanonical: {} };
  return JSON.parse(raw) as Aliases;
}

function fingerprint(name: string, city: string | null): string {
  return `${normalizeName(name)}|${city ? normalizeName(city) : ''}`;
}

interface RawAppearance {
  tournamentSlug: string;
  tournamentTitle: string;
  season: string;
  date: string | null;
  categoryKey: string;
  categoryLabel: string;
  position: number;
  otherTop8: Array<{ name: string; city: string | null; position: number }>;
}

interface PlayerAggregate {
  slug: string;
  primaryName: string;
  aliasNames: Set<string>;
  cities: Set<string>;
  appearances: RawAppearance[];
}

function loadTournaments(): TournamentPageT[] {
  const files = fs.readdirSync(TOURNAMENTS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(TOURNAMENTS_DIR, f), 'utf-8')) as TournamentPageT);
}

function loadPoints(): PointsSnapshotT | null {
  if (!fs.existsSync(POINTS_PATH)) return null;
  const raw = fs.readFileSync(POINTS_PATH, 'utf-8').trim();
  if (!raw) return null;
  return JSON.parse(raw) as PointsSnapshotT;
}

function loadChampions(): ChampionsPageT[] {
  if (!fs.existsSync(CHAMPIONS_DIR)) return [];
  const files = fs.readdirSync(CHAMPIONS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(CHAMPIONS_DIR, f), 'utf-8')) as ChampionsPageT);
}

interface MatchesFile {
  tournamentSlug: string;
  rounds: RoundPageT[];
}

function loadMatches(): MatchesFile[] {
  if (!fs.existsSync(MATCHES_DIR)) return [];
  const files = fs.readdirSync(MATCHES_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(MATCHES_DIR, f), 'utf-8')) as MatchesFile);
}

interface SlamStats {
  slamsFor: number;      // 25-0 sets the player won
  slamsAgainst: number;  // 25-0 sets scored against the player
  matchesPlayed: number;
  matchesWon: number;
}

function ensureSlamStats(byName: Map<string, SlamStats>, slug: string): SlamStats {
  let s = byName.get(slug);
  if (!s) { s = { slamsFor: 0, slamsAgainst: 0, matchesPlayed: 0, matchesWon: 0 }; byName.set(slug, s); }
  return s;
}

function tallyMatchStats(m: RoundPageT['matches'][number], a: SlamStats, b: SlamStats): void {
  a.matchesPlayed++;
  b.matchesPlayed++;
  if (m.winner === 'side1') a.matchesWon++;
  else if (m.winner === 'side2') b.matchesWon++;
  const setCount = Math.max(m.side1Scores.length, m.side2Scores.length);
  for (let i = 0; i < setCount; i++) {
    const x = m.side1Scores[i] ?? 0;
    const y = m.side2Scores[i] ?? 0;
    if (x === 25 && y === 0) { a.slamsFor++; b.slamsAgainst++; }
    else if (y === 25 && x === 0) { b.slamsFor++; a.slamsAgainst++; }
  }
}

function processMatch(m: RoundPageT['matches'][number], aliases: Aliases, byName: Map<string, SlamStats>, mergedSlugs: Set<string>, nameLookup: Map<string, string>): void {
  if (/^DUMMY\b/i.test(m.side1.name) || /^DUMMY\b/i.test(m.side2.name)) return;
  const s1Slug = resolvePostMerge(m.side1.name, m.side1.city, aliases, mergedSlugs, nameLookup);
  const s2Slug = resolvePostMerge(m.side2.name, m.side2.city, aliases, mergedSlugs, nameLookup);
  if (!s1Slug || !s2Slug) return;
  tallyMatchStats(m, ensureSlamStats(byName, s1Slug), ensureSlamStats(byName, s2Slug));
}

function computeSlams(matches: MatchesFile[], aliases: Aliases, mergedSlugs: Set<string>, nameLookup: Map<string, string>): Map<string, SlamStats> {
  const byName = new Map<string, SlamStats>();
  for (const file of matches) {
    for (const round of file.rounds) {
      for (const m of round.matches) processMatch(m, aliases, byName, mergedSlugs, nameLookup);
    }
  }
  return byName;
}

function canonicalSlugFor(name: string, city: string | null, aliases: Aliases): string {
  const fp = fingerprint(name, city);
  const mapped = aliases.variantToCanonical[fp];
  if (mapped) return mapped;
  return slugifyPlayer(name, city);
}

function ensurePlayer(players: Map<string, PlayerAggregate>, slug: string, name: string): PlayerAggregate {
  let agg = players.get(slug);
  if (agg) return agg;
  agg = {
    slug,
    primaryName: name,
    aliasNames: new Set(),
    cities: new Set(),
    appearances: [],
  };
  players.set(slug, agg);
  return agg;
}

function addAppearance(
  players: Map<string, PlayerAggregate>,
  aliases: Aliases,
  t: TournamentPageT,
  cat: TournamentPageT['categories'][number],
  entry: TournamentPageT['categories'][number]['top8'][number],
): void {
  const slug = canonicalSlugFor(entry.name, entry.city, aliases);
  if (!slug) return;
  const agg = ensurePlayer(players, slug, entry.name);
  agg.aliasNames.add(entry.name);
  if (entry.city) agg.cities.add(entry.city);

  const otherTop8 = cat.top8
    .filter(e => e !== entry)
    .map(e => ({ name: e.name, city: e.city, position: e.position }));

  const categoryLabel = cat.label || CATEGORY_LABELS[cat.key] || cat.key;
  agg.appearances.push({
    tournamentSlug: t.slug,
    tournamentTitle: t.title,
    season: t.season,
    date: t.date,
    categoryKey: cat.key,
    categoryLabel,
    position: entry.position,
    otherTop8,
  });
}

function aggregate(tournaments: TournamentPageT[], aliases: Aliases): Map<string, PlayerAggregate> {
  const players = new Map<string, PlayerAggregate>();
  for (const t of tournaments) {
    for (const cat of t.categories) {
      if (TEAM_CATEGORIES.has(cat.key)) continue;
      for (const entry of cat.top8) {
        addAppearance(players, aliases, t, cat, entry);
      }
    }
  }
  return consolidate(players);
}

// "Cities" that aren't cities — Indian states or affiliations. When a player has
// entries under both a real city and one of these, merge into the real-city entry.
const NON_CITY_HINTS = new Set([
  'maharashtra', 'india', 'karnataka', 'telangana', 'vidharbha', 'sri lanka', 'srilanka', 'england',
  'pspb', 'rbi', 'jisl', 'ongc', 'lic', 'air india', 'dascb', 'raigad',
  'jain supremos', 'jain irrigation', 'shivgarjana lions', 'carrom lovers',
  'youngsters', 'victorians',
]);

function isNonCity(city: string | null): boolean {
  if (!city) return true;
  return NON_CITY_HINTS.has(normalizeName(city));
}

function mergeInto(primary: PlayerAggregate, other: PlayerAggregate): void {
  for (const alias of other.aliasNames) primary.aliasNames.add(alias);
  for (const c of other.cities) primary.cities.add(c);
  primary.appearances.push(...other.appearances);
}

function consolidateGroup(group: PlayerAggregate[]): PlayerAggregate[] {
  group.sort((a, b) => b.appearances.length - a.appearances.length);
  const primary = group[0];
  const remaining: PlayerAggregate[] = [];
  for (let i = 1; i < group.length; i++) {
    const other = group[i];
    if ([...other.cities].every(isNonCity)) mergeInto(primary, other);
    else remaining.push(other);
  }
  return [primary, ...remaining];
}

// Second-pass merge: for same-loose-name groups, merge into the primary if their
// city sets overlap or the smaller entry's cities are all non-cities.
function consolidateLooseGroup(group: PlayerAggregate[]): PlayerAggregate[] {
  group.sort((a, b) => b.appearances.length - a.appearances.length);
  const primary = group[0];
  const remaining: PlayerAggregate[] = [];
  const primaryRealCities = new Set([...primary.cities].filter(c => !isNonCity(c)).map(c => normalizeName(c)));
  for (let i = 1; i < group.length; i++) {
    const other = group[i];
    const otherRealCities = [...other.cities].filter(c => !isNonCity(c)).map(c => normalizeName(c));
    const overlaps = otherRealCities.some(c => primaryRealCities.has(c));
    const allNonCity = otherRealCities.length === 0;
    if (overlaps || allNonCity) mergeInto(primary, other);
    else remaining.push(other);
  }
  return [primary, ...remaining];
}

function groupBy<T>(items: Iterable<T>, keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const arr = out.get(k) ?? [];
    arr.push(item);
    out.set(k, arr);
  }
  return out;
}

// After the raw pass, run two rounds of consolidation:
// 1) strict same-normalized-name — merges "X (India)" into "X (Mumbai)".
// 2) loose (middle-initial-stripped) — merges "Aakanksha U Kadam (Ratnagiri)" into
//    "Aakanksha Kadam (Ratnagiri)". Both come from MCA but different pages format
//    names differently, causing duplicate aggregates.
function consolidate(players: Map<string, PlayerAggregate>): Map<string, PlayerAggregate> {
  // Pass 1: strict
  const strict = new Map<string, PlayerAggregate>();
  const byStrict = groupBy(players.values(), a => normalizeName(a.primaryName));
  for (const group of byStrict.values()) {
    const consolidated = group.length === 1 ? group : consolidateGroup(group);
    for (const agg of consolidated) strict.set(agg.slug, agg);
  }

  // Pass 2: loose
  const final = new Map<string, PlayerAggregate>();
  const byLoose = groupBy(strict.values(), a => looseName(a.primaryName));
  for (const group of byLoose.values()) {
    const consolidated = group.length === 1 ? group : consolidateLooseGroup(group);
    for (const agg of consolidated) final.set(agg.slug, agg);
  }
  return final;
}

interface PlayerRival {
  slug: string;
  name: string;
  city: string | null;
  coAppearances: number;
  wonAgainst: number;
  lostAgainst: number;
}

// A looser normalized form that drops single-letter middle initials.
// "Prashant S More" and "Prashant More" resolve to the same key. Preserves the
// display form; only used for lookups.
function looseName(name: string): string {
  const parts = normalizeName(name).split(' ');
  return parts.filter(p => p.length > 1).join(' ');
}

function resolvePostMerge(name: string, city: string | null, aliases: Aliases, mergedSlugs: Set<string>, byName: Map<string, string>): string | null {
  const raw = canonicalSlugFor(name, city, aliases);
  if (raw && mergedSlugs.has(raw)) return raw;
  const strict = byName.get(normalizeName(name));
  if (strict) return strict;
  return byName.get(looseName(name)) ?? null;
}

function buildRivals(agg: PlayerAggregate, aliases: Aliases, mergedSlugs: Set<string>, byName: Map<string, string>): PlayerRival[] {
  const acc = new Map<string, { name: string; city: string | null; co: number; won: number; lost: number }>();
  for (const app of agg.appearances) {
    for (const other of app.otherTop8) {
      const otherSlug = resolvePostMerge(other.name, other.city, aliases, mergedSlugs, byName);
      if (!otherSlug || otherSlug === agg.slug) continue;
      let r = acc.get(otherSlug);
      if (!r) {
        r = { name: other.name, city: other.city, co: 0, won: 0, lost: 0 };
        acc.set(otherSlug, r);
      }
      r.co++;
      if (app.position < other.position) r.won++;
      else if (app.position > other.position) r.lost++;
    }
  }
  return [...acc.entries()]
    .map(([slug, r]) => ({
      slug,
      name: r.name,
      city: r.city,
      coAppearances: r.co,
      wonAgainst: r.won,
      lostAgainst: r.lost,
    }))
    .sort((a, b) => b.coAppearances - a.coAppearances || a.name.localeCompare(b.name));
}

function pickPrimaryName(agg: PlayerAggregate): string {
  const variants = [...agg.aliasNames];
  variants.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return variants[0] ?? agg.primaryName;
}

function primaryCity(agg: PlayerAggregate): string | null {
  return [...agg.cities][0] ?? null;
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(full: string, obj: unknown): void {
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
}

function clearOldPlayerFiles(): void {
  if (!fs.existsSync(PLAYERS_DIR)) return;
  for (const f of fs.readdirSync(PLAYERS_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(PLAYERS_DIR, f));
  }
}

interface Title {
  scope: 'national' | 'state';
  categoryKey: string;
  categoryLabel: string;
  years: number[];
}

function resolveByNameOnly(
  name: string,
  cityHint: string | null,
  byName: Map<string, string[]>,
): string | null {
  const key = normalizeName(name);
  const candidates = byName.get(key);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Multiple players share this normalized name; prefer one whose city matches the hint.
  if (cityHint) {
    const cityNorm = normalizeName(cityHint);
    for (const slug of candidates) {
      if (slug.includes(cityNorm.replaceAll(' ', '-'))) return slug;
    }
  }
  return candidates[0];
}

try {
  const tournaments = loadTournaments();
  console.log(`loaded ${tournaments.length} tournaments`);

  const aliases = loadAliases();
  const players = aggregate(tournaments, aliases);
  console.log(`aggregated ${players.size} players`);

  // Post-consolidation lookups used by rivals and match/slam stats. Register both
  // strict and "loose" (middle-initial-stripped) forms — match pages use "Prashant S More"
  // while tournament tops use "Prashant More". Strict keys win over loose keys on collision.
  const mergedSlugs = new Set(players.keys());
  const nameToSlug = new Map<string, string>();
  const registerLoose = (agg: PlayerAggregate, name: string) => {
    const loose = looseName(name);
    if (loose && !nameToSlug.has(loose)) nameToSlug.set(loose, agg.slug);
  };
  for (const agg of players.values()) {
    nameToSlug.set(normalizeName(agg.primaryName), agg.slug);
    for (const alias of agg.aliasNames) nameToSlug.set(normalizeName(alias), agg.slug);
  }
  // Second pass: register loose keys only for names that don't already resolve strictly,
  // so unrelated players with the same initials-stripped name don't clobber each other.
  for (const agg of players.values()) {
    registerLoose(agg, agg.primaryName);
    for (const alias of agg.aliasNames) registerLoose(agg, alias);
  }

  const points = loadPoints();
  const championsPages = loadChampions();
  const matchesFiles = loadMatches();
  const slamsBySlug = computeSlams(matchesFiles, aliases, mergedSlugs, nameToSlug);
  console.log(`loaded points snapshot (${points?.categories.length ?? 0} categories), ${championsPages.length} champion pages, ${matchesFiles.length} match files`);
  console.log(`  computed slam stats for ${slamsBySlug.size} players`);

  // Build a name → [slugs] map for name-only resolvers (points/champions data
  // lacks a "city" field in the same shape).
  const byName = new Map<string, string[]>();
  for (const agg of players.values()) {
    for (const alias of agg.aliasNames) {
      const key = normalizeName(alias);
      if (!byName.has(key)) byName.set(key, []);
      const arr = byName.get(key)!;
      if (!arr.includes(agg.slug)) arr.push(agg.slug);
    }
  }

  // Points → slug → { rank, points, affiliation }
  const pointsBySlug = new Map<string, { rank: number; total: number; affiliation: string | null; categoryKey: string; categoryLabel: string }>();
  if (points) {
    for (const cat of points.categories) {
      for (const row of cat.rows) {
        const slug = resolveByNameOnly(row.name, row.affiliation, byName);
        if (!slug) continue;
        pointsBySlug.set(slug, {
          rank: row.rank,
          total: row.total,
          affiliation: row.affiliation,
          categoryKey: cat.key,
          categoryLabel: cat.label,
        });
      }
    }
  }

  // Champions → slug → Title[]
  const titlesBySlug = new Map<string, Title[]>();
  for (const page of championsPages) {
    for (const c of page.champions) {
      const slug = resolveByNameOnly(c.name, c.affiliation, byName);
      if (!slug) continue;
      const arr = titlesBySlug.get(slug) ?? [];
      arr.push({
        scope: page.scope,
        categoryKey: page.categoryKey,
        categoryLabel: page.categoryLabel,
        years: c.years,
      });
      titlesBySlug.set(slug, arr);
    }
  }

  clearOldPlayerFiles();
  ensureDir(PLAYERS_DIR);

  const index: Array<{
    slug: string;
    name: string;
    city: string | null;
    affiliation: string | null;
    podium: { first: number; second: number; third: number; top8: number };
    currentPoints: number | null;
    currentRank: number | null;
    titles: number;
  }> = [];

  for (const agg of players.values()) {
    const name = pickPrimaryName(agg);
    const city = primaryCity(agg);
    const podium = {
      first: agg.appearances.filter(a => a.position === 1).length,
      second: agg.appearances.filter(a => a.position === 2).length,
      third: agg.appearances.filter(a => a.position === 3).length,
      top8: agg.appearances.length,
    };
    const rivals = buildRivals(agg, aliases, mergedSlugs, nameToSlug);

    const appearances = [...agg.appearances]
      .map(a => ({
        tournamentSlug: a.tournamentSlug,
        tournamentTitle: a.tournamentTitle,
        season: a.season,
        date: a.date,
        categoryKey: a.categoryKey,
        categoryLabel: a.categoryLabel,
        position: a.position,
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.tournamentSlug.localeCompare(b.tournamentSlug));

    const pts = pointsBySlug.get(agg.slug) ?? null;
    const titles = titlesBySlug.get(agg.slug) ?? [];
    const titleCount = titles.reduce((s, t) => s + t.years.length, 0);
    const slams = slamsBySlug.get(agg.slug) ?? null;

    const record = {
      slug: agg.slug,
      name,
      aliases: [...agg.aliasNames].sort((a, b) => a.localeCompare(b)),
      cities: [...agg.cities].sort((a, b) => a.localeCompare(b)),
      affiliation: pts?.affiliation ?? null,
      podium,
      currentPoints: pts?.total ?? null,
      currentRank: pts?.rank ?? null,
      currentRankCategory: pts?.categoryLabel ?? null,
      titles: titles.toSorted((a, b) =>
        a.scope.localeCompare(b.scope) || a.categoryKey.localeCompare(b.categoryKey),
      ),
      slams: slams?.slamsFor ?? null,
      slamsAgainst: slams?.slamsAgainst ?? null,
      matchesPlayed: slams?.matchesPlayed ?? null,
      matchesWon: slams?.matchesWon ?? null,
      appearances,
      rivals,
    };

    writeJson(path.join(PLAYERS_DIR, `${agg.slug}.json`), record);
    index.push({
      slug: agg.slug,
      name,
      city,
      affiliation: pts?.affiliation ?? null,
      podium,
      currentPoints: pts?.total ?? null,
      currentRank: pts?.rank ?? null,
      titles: titleCount,
      slams: slams?.slamsFor ?? null,
      matchesPlayed: slams?.matchesPlayed ?? null,
      matchesWon: slams?.matchesWon ?? null,
    });
  }

  index.sort((a, b) => b.podium.top8 - a.podium.top8 || a.name.localeCompare(b.name));
  writeJson(path.join(PLAYERS_DIR, '_index.json'), index);

  console.log(`wrote ${players.size} player files + _index.json`);
  console.log(`  ${pointsBySlug.size} players matched to points table`);
  console.log(`  ${titlesBySlug.size} players matched to champion titles`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
