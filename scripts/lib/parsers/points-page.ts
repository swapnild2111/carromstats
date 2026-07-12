import * as cheerio from 'cheerio';
import type { AnyNode, Cheerio, CheerioAPI, Element } from 'cheerio';
import { collapseWs, parsePointsPlayer } from '../normalize.js';
import { PointsSnapshot, type PointsSnapshotT } from '../schemas.js';

const CATEGORY_MAP: Array<{ re: RegExp; key: 'men' | 'women' | 'veteran_men' | 'veteran_women'; label: string }> = [
  { re: /\bveteran\b.*\bwomen\b.*points\s+table/i, key: 'veteran_women', label: 'Veteran Women' },
  { re: /\bveteran\b.*\bmen\b.*points\s+table/i, key: 'veteran_men', label: 'Veteran Men' },
  { re: /\bwomen\b.*single.*points\s+table/i, key: 'women', label: "Women's Singles" },
  { re: /\bmen\b.*single.*points\s+table/i, key: 'men', label: "Men's Singles" },
];

function categoryForHeading(text: string): { key: PointsSnapshotT['categories'][number]['key']; label: string } | null {
  for (const c of CATEGORY_MAP) if (c.re.test(text)) return { key: c.key, label: c.label };
  return null;
}

// Combined table variants:
//   [Sr., RK, Name, 1, 2, 3, ..., T]   — full table with per-tournament breakdown
//   [RK, Name, 1, 2, 3, ..., T]        — Sr. sometimes missing
//   [RK, Name, 1]                      — single-tournament (no T column)
function classifyHeader(headers: string[]): { nameIdx: number; firstTIdx: number; hasTotal: boolean } | null {
  const norm = headers.map(h => h.trim().toLowerCase().replace(/\.$/, ''));
  const rkIdx = norm.indexOf('rk');
  if (rkIdx < 0) return null;
  const nameIdx = norm.indexOf('name', rkIdx);
  if (nameIdx < 0) return null;
  const lastIdx = norm.length - 1;
  const hasTotal = norm[lastIdx] === 't';
  const firstTIdx = nameIdx + 1;
  if (firstTIdx > lastIdx) return null;
  return { nameIdx, firstTIdx, hasTotal };
}

function extractHeaderRow(table: Cheerio<AnyNode>, $: CheerioAPI): string[] {
  const firstRow = table.find('tr').first();
  return firstRow.find('th,td').map((_, c) => collapseWs($(c).text())).get();
}

function parseIntOrNull(s: string): number | null {
  const t = s.trim();
  if (!t || t === '-' || t === '—') return null;
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

function parseCategoryTable(table: Cheerio<AnyNode>, $: CheerioAPI): {
  tournamentHeaders: string[];
  rows: PointsSnapshotT['categories'][number]['rows'];
} | null {
  const headers = extractHeaderRow(table, $);
  const cls = classifyHeader(headers);
  if (!cls) return null;

  const perTournamentEnd = cls.hasTotal ? headers.length - 1 : headers.length;
  const tournamentHeaders = headers.slice(cls.firstTIdx, perTournamentEnd);
  const rows: PointsSnapshotT['categories'][number]['rows'] = [];

  table.find('tr').each((i, tr) => {
    if (i === 0) return;
    const cells = $(tr).find('td').map((_, c) => collapseWs($(c).text())).get();
    if (cells.length !== headers.length) return;
    const rkRaw = cells[cls.nameIdx - 1].replace(/^#/, '');
    const rank = Number.parseInt(rkRaw, 10);
    if (Number.isNaN(rank)) return;
    const parsed = parsePointsPlayer(cells[cls.nameIdx]);
    const perTournament = cells.slice(cls.firstTIdx, perTournamentEnd).map(parseIntOrNull);
    const total = cls.hasTotal
      ? (parseIntOrNull(cells.at(-1) ?? '') ?? 0)
      : perTournament.reduce<number>((s, v) => s + (v ?? 0), 0);
    rows.push({
      rank,
      name: parsed.name,
      affiliation: parsed.affiliation ?? parsed.city,
      perTournament,
      total,
    });
  });

  return { tournamentHeaders, rows };
}

interface LinearItem {
  kind: 'heading' | 'table' | 'h4';
  el: Element;
  text?: string;
}

// Turn "3 10th Shree Dattaraj Charitable Trust, Nrursinghwadi State Carrom Tournament 2026-27,
// Nrursinghwadi, Kolhapur 4th to 6th July, 2026" into "10th Shree Dattaraj Charitable Trust".
function cleanTournamentLabel(raw: string): string {
  const noIdx = raw.replace(/^\d+\s+/, '');
  const commaIdx = noIdx.indexOf(',');
  if (commaIdx < 0) return noIdx;
  return noIdx.slice(0, commaIdx).trim();
}

function linearize($: CheerioAPI): LinearItem[] {
  const out: LinearItem[] = [];
  $('h3, h4, table').each((_, el) => {
    if (el.tagName === 'h3') {
      const text = collapseWs($(el).text());
      if (/POINTS TABLE/i.test(text)) out.push({ kind: 'heading', el, text });
    } else if (el.tagName === 'h4') {
      const text = collapseWs($(el).text());
      if (text.length > 20 && text.length < 300) out.push({ kind: 'h4', el, text });
    } else {
      out.push({ kind: 'table', el });
    }
  });
  return out;
}

function collectTournamentLabels(stream: LinearItem[], fromIdx: number): string[] {
  const labels: string[] = [];
  for (let j = fromIdx; j < stream.length; j++) {
    const next = stream[j];
    if (next.kind === 'heading') break;
    if (next.kind === 'h4' && next.text) labels.push(cleanTournamentLabel(next.text));
  }
  return labels;
}

function findCategoryTable(
  stream: LinearItem[],
  fromIdx: number,
  $: CheerioAPI,
): { tournamentHeaders: string[]; rows: PointsSnapshotT['categories'][number]['rows'] } | null {
  for (let j = fromIdx; j < stream.length; j++) {
    const next = stream[j];
    if (next.kind === 'heading') return null;
    const parsed = parseCategoryTable($(next.el), $);
    if (parsed) return parsed;
  }
  return null;
}

export function parsePointsPage(html: string): PointsSnapshotT {
  const $ = cheerio.load(html);
  const stream = linearize($);
  const categories: PointsSnapshotT['categories'] = [];
  const seen = new Set<string>();

  for (let i = 0; i < stream.length; i++) {
    const item = stream[i];
    if (item.kind !== 'heading') continue;
    const cat = categoryForHeading(collapseWs($(item.el).text()));
    if (!cat || seen.has(cat.key)) continue;
    const parsed = findCategoryTable(stream, i + 1, $);
    if (!parsed) continue;
    const richLabels = collectTournamentLabels(stream, i + 1);
    seen.add(cat.key);
    // Prefer h4-derived labels when their count matches the numeric column count.
    const headers = richLabels.length === parsed.tournamentHeaders.length
      ? richLabels
      : parsed.tournamentHeaders;
    categories.push({
      key: cat.key,
      label: cat.label,
      tournamentHeaders: headers,
      rows: parsed.rows,
    });
  }

  const snapshot: PointsSnapshotT = {
    fetchedAt: '',
    asOf: null,
    categories,
  };
  return PointsSnapshot.parse(snapshot);
}
