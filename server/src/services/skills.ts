import { RELATED_SKILLS, SKILL_ALIASES } from './skills.data.js';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word boundaries that also work for tokens like "c++", "c#", ".net", "ci/cd".
function boundary(token: string, flags: string): RegExp {
  return new RegExp(`(?<![\\w+#.])${escapeRegex(token)}(?![\\w+#]|\\.\\w)`, flags);
}

// Aliases that are also ordinary English words or abbreviations. They only count when written in
// their technical casing (e.g. "Go", "TS", "ML", "REST", "Node"), never as lowercase prose.
const WEAK_ALIASES = new Set([
  'go', 'r', 'c', 'ts', 'js', 'ml', 'rest', 'node', 'express', 'spring', 'swift', 'rust', 'dart',
  'java', 'excel', 'git', 'agile', 'scrum', 'sap', 'tally', 'oracle', 'mongo', 'vue', 'flask',
  'communication', 'leadership', 'teamwork', 'collaboration', 'accounting',
]);

interface CompiledSkill {
  canonical: string;
  strong: RegExp[];
  weak: RegExp[];
}

const COMPILED: CompiledSkill[] = Object.entries(SKILL_ALIASES).map(([canonical, aliases]) => {
  const all = [...new Set([canonical.toLowerCase(), ...aliases])];
  const strong: RegExp[] = [];
  const weak: RegExp[] = [];
  for (const alias of all) {
    if (WEAK_ALIASES.has(alias)) {
      // Case-sensitive: the canonical spelling, Title case, or UPPERCASE.
      const forms = new Set([canonical, alias[0].toUpperCase() + alias.slice(1), alias.toUpperCase()]);
      for (const f of forms) if (f.toLowerCase() === alias) weak.push(boundary(f, ''));
    } else {
      strong.push(boundary(alias, 'i'));
    }
  }
  return { canonical, strong, weak };
});

// Soft skills are too generic to count as evidence in prose; they only match from the skills list.
const SOFT_SKILLS = new Set(['Communication', 'Leadership', 'Teamwork', 'Problem Solving']);

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a free-text skill (e.g. "reactjs") to its canonical name, or a tidied version of itself. */
export function canonicalSkill(raw: string): string {
  const s = normalizeText(raw).replace(/[;,.]+$/, '');
  const lower = s.toLowerCase();
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (canonical.toLowerCase() === lower || aliases.includes(lower)) return canonical;
  }
  return s;
}

function matches(entry: CompiledSkill, text: string): boolean {
  return entry.strong.some((p) => p.test(text)) || entry.weak.some((p) => p.test(text));
}

/** Find dictionary skills mentioned anywhere in a block of text (e.g. a job description). */
export function extractSkills(text: string, { includeSoft = true } = {}): string[] {
  const t = normalizeText(text);
  return COMPILED.filter((e) => (includeSoft || !SOFT_SKILLS.has(e.canonical)) && matches(e, t)).map((e) => e.canonical);
}

export function textMentionsSkill(text: string, canonical: string): boolean {
  const t = normalizeText(text);
  const entry = COMPILED.find((c) => c.canonical === canonical);
  if (!entry) return boundary(canonical, 'i').test(t);
  return matches(entry, t);
}

export function relatedSkills(canonical: string): string[] {
  const out = new Set<string>();
  for (const group of RELATED_SKILLS) {
    if (group.includes(canonical)) group.forEach((g) => g !== canonical && out.add(g));
  }
  return [...out];
}

export function isDictionarySkill(raw: string): boolean {
  return canonicalSkill(raw) in SKILL_ALIASES;
}

/** Remove case-insensitive duplicates, keeping the first spelling. */
export function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function isSoftSkill(canonical: string): boolean {
  return SOFT_SKILLS.has(canonical);
}
