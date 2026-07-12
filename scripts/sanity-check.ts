import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');

interface Counts {
  tournaments: number;
  players: number;
  champions: number;
  pointsRows: number;
  championSet: Set<string>;
}

function readJson<T>(rel: string, fallback: T): T {
  const full = path.join(DATA_DIR, rel);
  if (!fs.existsSync(full)) return fallback;
  const raw = fs.readFileSync(full, 'utf-8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

function computeCounts(): Counts {
  const tournaments = readJson<Array<unknown>>('tournaments/_index.json', []);
  const players = readJson<Array<unknown>>('players/_index.json', []);
  const points = readJson<{ categories: Array<{ rows: unknown[] }> }>('points/current.json', { categories: [] });
  const pointsRows = points.categories.reduce((s, c) => s + c.rows.length, 0);

  const championsDir = path.join(DATA_DIR, 'champions');
  const championSet = new Set<string>();
  let championCount = 0;
  if (fs.existsSync(championsDir)) {
    for (const f of fs.readdirSync(championsDir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const page = JSON.parse(fs.readFileSync(path.join(championsDir, f), 'utf-8')) as { scope: string; categoryKey: string; champions: Array<{ name: string }> };
      championCount += page.champions.length;
      for (const c of page.champions) {
        championSet.add(`${page.scope}|${page.categoryKey}|${c.name.toLowerCase()}`);
      }
    }
  }

  return {
    tournaments: tournaments.length,
    players: players.length,
    champions: championCount,
    pointsRows,
    championSet,
  };
}

const SAFE_ENV = { PATH: '/usr/local/bin:/usr/bin:/bin' };

function loadPrevCounts(): Counts | null {
  // Prev = whatever's committed on HEAD before this scrape ran.
  // Stash current data/ aside via fs (not shell), restore committed via git, compute, swap back.
  const stashDir = path.join(ROOT, '.sanity-stash');
  const stashedData = path.join(stashDir, 'data');
  try {
    fs.mkdirSync(stashDir, { recursive: true });
    if (fs.existsSync(stashedData)) fs.rmSync(stashedData, { recursive: true, force: true });
    fs.cpSync(DATA_DIR, stashedData, { recursive: true });

    execSync('git checkout HEAD -- data', { cwd: ROOT, stdio: 'inherit', env: SAFE_ENV });
    const prev = computeCounts();

    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.cpSync(stashedData, DATA_DIR, { recursive: true });
    fs.rmSync(stashDir, { recursive: true, force: true });
    return prev;
  } catch (err) {
    console.warn('sanity-check: could not compute prev counts (probably first run):', (err as Error).message);
    return null;
  }
}

interface Alert {
  kind: 'drop' | 'jump' | 'missing-title' | 'first-run';
  message: string;
}

function compare(prev: Counts, next: Counts): Alert[] {
  const alerts: Alert[] = [];
  const dropPct = -0.05;
  const jumpPct = 0.5;

  const check = (label: string, before: number, after: number) => {
    if (before === 0) return;
    const delta = (after - before) / before;
    if (delta < dropPct) alerts.push({ kind: 'drop', message: `${label}: ${before} → ${after} (${(delta * 100).toFixed(1)}%)` });
    else if (delta > jumpPct) alerts.push({ kind: 'jump', message: `${label}: ${before} → ${after} (+${(delta * 100).toFixed(1)}%)` });
  };
  check('tournaments', prev.tournaments, next.tournaments);
  check('players', prev.players, next.players);
  check('champion entries', prev.champions, next.champions);
  check('points rows', prev.pointsRows, next.pointsRows);

  const lost = [...prev.championSet].filter(s => !next.championSet.has(s));
  if (lost.length > 5) {
    alerts.push({ kind: 'missing-title', message: `${lost.length} champion entries missing from new data (first 3: ${lost.slice(0, 3).join(' / ')})` });
  }

  return alerts;
}

const next = computeCounts();
console.log('current counts:', {
  tournaments: next.tournaments,
  players: next.players,
  champions: next.champions,
  pointsRows: next.pointsRows,
});

const prev = loadPrevCounts();
if (!prev) {
  console.log('sanity-check: no previous baseline (first run) — passing.');
  process.exit(0);
}

console.log('previous counts:', {
  tournaments: prev.tournaments,
  players: prev.players,
  champions: prev.champions,
  pointsRows: prev.pointsRows,
});

const alerts = compare(prev, next);
if (alerts.length === 0) {
  console.log('sanity-check: OK');
  process.exit(0);
}

console.error('sanity-check FAILED:');
for (const a of alerts) console.error(`  [${a.kind}] ${a.message}`);
process.exit(1);
