import { z } from 'zod';

export const TournamentIndexEntry = z.object({
  pagePath: z.string(),
  label: z.string(),
  urlYear: z.number().int(),
  seasonHint: z.string().nullable(),
});

export const TopEightEntry = z.object({
  position: z.number().int().min(1),
  name: z.string().min(1),
  city: z.string().nullable(),
});

export const TournamentPage = z.object({
  slug: z.string(),
  pagePath: z.string(),
  title: z.string(),
  urlYear: z.number().int(),
  season: z.string(),
  date: z.string().nullable(),
  venue: z.string().nullable(),
  hasResultsSubPage: z.boolean(),
  categories: z.array(z.object({
    key: z.string(),
    label: z.string(),
    top8: z.array(TopEightEntry),
  })),
});

export const MatchSide = z.object({
  name: z.string(),
  city: z.string().nullable(),
});

export const MatchRow = z.object({
  matchNo: z.number().int().nullable(),
  side1: MatchSide,
  side2: MatchSide,
  side1Scores: z.array(z.number().int().nullable()),
  side2Scores: z.array(z.number().int().nullable()),
  winner: z.enum(['side1', 'side2', 'unknown']),
});

export const RoundPage = z.object({
  tournamentSlug: z.string(),
  categoryKey: z.string(),
  roundKey: z.string(),
  roundLabel: z.string(),
  matches: z.array(MatchRow),
});

export const PointsRow = z.object({
  rank: z.number().int(),
  name: z.string(),
  affiliation: z.string().nullable(),
  perTournament: z.array(z.number().int().nullable()),
  total: z.number().int(),
});

export const PointsCategory = z.object({
  key: z.enum(['men', 'women', 'veteran_men', 'veteran_women']),
  label: z.string(),
  tournamentHeaders: z.array(z.string()),
  rows: z.array(PointsRow),
});

export const PointsSnapshot = z.object({
  fetchedAt: z.string(),
  asOf: z.string().nullable(),
  categories: z.array(PointsCategory),
});

export const ChampionEntry = z.object({
  name: z.string(),
  affiliation: z.string().nullable(),
  years: z.array(z.number().int()),
});

export const ChampionsPage = z.object({
  categoryKey: z.string(),
  categoryLabel: z.string(),
  scope: z.enum(['national', 'state']),
  champions: z.array(ChampionEntry),
});

export type TournamentPageT = z.infer<typeof TournamentPage>;
export type RoundPageT = z.infer<typeof RoundPage>;
export type PointsSnapshotT = z.infer<typeof PointsSnapshot>;
export type ChampionsPageT = z.infer<typeof ChampionsPage>;
export type TournamentIndexEntryT = z.infer<typeof TournamentIndexEntry>;
