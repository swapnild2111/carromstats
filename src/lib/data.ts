import fs from 'node:fs';
import path from 'node:path';

// Astro invokes this from the project root; using process.cwd() is more
// reliable than import.meta.url after bundling, which relocates modules.
const DATA_DIR = path.join(process.cwd(), 'data');

function safeReadJson<T>(rel: string, fallback: T): T {
  const full = path.join(DATA_DIR, rel);
  if (!fs.existsSync(full)) return fallback;
  const raw = fs.readFileSync(full, 'utf-8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

export interface PlayerAppearance {
  tournamentSlug: string;
  tournamentTitle: string;
  season: string;
  date: string | null;
  categoryKey: string;
  categoryLabel: string;
  position: number;
}

export interface PlayerRival {
  slug: string;
  name: string;
  city: string | null;
  coAppearances: number;
  wonAgainst: number;
  lostAgainst: number;
}

export interface PlayerTitle {
  scope: 'national' | 'state';
  categoryKey: string;
  categoryLabel: string;
  years: number[];
}

export interface PlayerRecord {
  slug: string;
  name: string;
  aliases: string[];
  cities: string[];
  affiliation: string | null;
  podium: { first: number; second: number; third: number; top8: number };
  currentPoints: number | null;
  currentRank: number | null;
  currentRankCategory: string | null;
  titles: PlayerTitle[];
  slams: number | null;
  slamsAgainst: number | null;
  matchesPlayed: number | null;
  matchesWon: number | null;
  appearances: PlayerAppearance[];
  rivals: PlayerRival[];
}

export interface PlayerIndexEntry {
  slug: string;
  name: string;
  city: string | null;
  affiliation: string | null;
  podium: { first: number; second: number; third: number; top8: number };
  currentPoints: number | null;
  currentRank: number | null;
  titles: number;
  slams: number | null;
  matchesPlayed: number | null;
  matchesWon: number | null;
}

export interface TournamentTopEight {
  position: number;
  name: string;
  city: string | null;
  playerSlug: string | null;
}

export interface TournamentCategory {
  key: string;
  label: string;
  top8: TournamentTopEight[];
}

export interface TournamentRecord {
  slug: string;
  title: string;
  season: string;
  date: string | null;
  venue: string | null;
  categories: TournamentCategory[];
}

export interface TournamentSummary {
  slug: string;
  title: string;
  season: string;
  date: string | null;
  venue: string | null;
  categories: string[];
}

export function getPlayerIndex(): PlayerIndexEntry[] {
  return safeReadJson<PlayerIndexEntry[]>('players/_index.json', []);
}

export function getPlayerRecord(slug: string): PlayerRecord | null {
  return safeReadJson<PlayerRecord | null>(`players/${slug}.json`, null);
}

export function getTournamentIndex(): TournamentSummary[] {
  return safeReadJson<TournamentSummary[]>('tournaments/_index.json', []);
}

export function getTournamentRecord(slug: string): TournamentRecord | null {
  const raw = safeReadJson<TournamentRecord | null>(`tournaments/${slug}.json`, null);
  if (!raw) return null;
  const knownSlugs = new Set(getPlayerIndex().map(p => p.slug));
  const resolved: TournamentRecord = {
    ...raw,
    categories: raw.categories.map(c => ({
      ...c,
      top8: c.top8.map(e => ({
        ...e,
        playerSlug: resolvePlayerSlug(e.name, e.city, knownSlugs),
      })),
    })),
  };
  return resolved;
}

function resolvePlayerSlug(name: string, city: string | null, known: Set<string>): string | null {
  const slug = slugifyPlayerForSite(name, city);
  return known.has(slug) ? slug : null;
}

// Minimal duplicate of scripts/lib/normalize.ts:slugifyPlayer — kept in-site so
// Astro doesn't have to import from scripts/ (which uses different module setup).
function slugifyPlayerForSite(name: string, city: string | null): string {
  const norm = (s: string) => s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9 ]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(' ', '-');
  const base = norm(name);
  const c = city ? '-' + norm(city) : '';
  return (base + c).replaceAll(/-+/g, '-').replace(/^-|-$/g, '');
}
