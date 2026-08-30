export interface RankingRule {
  readonly term: RegExp;
  readonly bonus: number;
  readonly condition?: (
    query: string,
    title: string,
    durationSeconds?: number,
  ) => boolean;
}

export const TITLE_BONUSES: readonly RankingRule[] = [
  { term: /\bofficial audio\b/i, bonus: 10 },
  { term: /\bofficial video\b/i, bonus: 10 },
  { term: /\btopic\b/i, bonus: 10 },
  { term: /\bprovided to youtube\b/i, bonus: 8 },
  { term: /\bvisualizer\b/i, bonus: 8 },
  {
    term: /\b(remastered|deluxe)\b/i,
    bonus: 5,
    condition: (query) => {
      const lower = query.toLowerCase();
      return !lower.includes("remastered") && !lower.includes("deluxe");
    },
  },
];

export const TITLE_PENALTIES: readonly RankingRule[] = [
  {
    term: /\binstrumental\b/i,
    bonus: -15,
    condition: (query) => !query.toLowerCase().includes("instrumental"),
  },
  {
    term: /\blyric video\b/i,
    bonus: -10,
    condition: (query) => !/\blyrics?\b/i.test(query),
  },
  {
    term: /\bcover\b/i,
    bonus: -20,
    condition: (query) => !query.toLowerCase().includes("cover"),
  },
  {
    term: /\bremix\b/i,
    bonus: -20,
    condition: (query) => !query.toLowerCase().includes("remix"),
  },
  {
    term: /\blive\b/i,
    bonus: -15,
    condition: (query) => !query.toLowerCase().includes("live"),
  },
  {
    term: /\bacoustic\b/i,
    bonus: -10,
    condition: (query) => !query.toLowerCase().includes("acoustic"),
  },
  { term: /\b(slowed|sped up|nightcore)\b/i, bonus: -25 },
  {
    term: /\bclean\b/i,
    bonus: -15,
    condition: (query) => !query.toLowerCase().includes("clean"),
  },
  {
    term: /\b(extended|full version|verison)\b/i,
    bonus: -15,
    condition: (query) => !/\b(extended|full)\b/i.test(query),
  },
  {
    term: /\b(reaction|review)\b/i,
    bonus: -15,
    condition: (query) => !/\b(reaction|review)\b/i.test(query),
  },
  {
    term: /\b(karaoke|aoke)\b/i,
    bonus: -20,
    condition: (query) => !/\b(karaoke|aoke)\b/i.test(query),
  },
];

export const DURATION_RULES: readonly RankingRule[] = [
  {
    term: /./,
    bonus: -30,
    condition: (_query, _title, durationSeconds) =>
      durationSeconds !== undefined && durationSeconds > 1800,
  },
  {
    term: /./,
    bonus: -20,
    condition: (_query, _title, durationSeconds) =>
      durationSeconds !== undefined && durationSeconds < 45,
  },
];

export function applyRankingRules(
  query: string,
  title: string,
  rules: readonly RankingRule[],
  durationSeconds?: number,
): number {
  let total = 0;
  for (const rule of rules) {
    if (!rule.term.test(title)) continue;
    if (
      rule.condition !== undefined &&
      !rule.condition(query, title, durationSeconds)
    )
      continue;
    total += rule.bonus;
  }
  return total;
}
