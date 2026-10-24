import type { ResumeContent } from '../types/resume.js';
import { depersonalize } from './parsing/structure.js';
import { ACTION_START, BULLET_RE, DEGREE_RE, INSTITUTION_RE, findDates, words } from './parsing/patterns.js';
import { normKey } from './resumeMerge.service.js';

/*
 * Bullet suggestions without AI: for roles and projects that have fewer than two bullets, find sentences
 * in the candidate's own documents that talk about that company or project (often in a LinkedIn summary
 * or "About" text), and offer them as bullets. Nothing is invented and nothing is added until the user
 * clicks "Add".
 */

export interface BulletSuggestion {
  section: 'experience' | 'projects';
  index: number;
  sentences: string[];
}

const NEEDS = 2;
const MAX_PER_ENTRY = 4;
const WORK_VERB = /^(i\s+(?:also\s+)?)?(develop|build|built|design|create|lead|led|manage|maintain|implement|work|worked|deliver|own|automate|optimi[sz]e|integrate|deploy|support|test|analy[sz]e|write|wrote|handle|collaborate|mentor|drive|improve)/i;

function sentencesOf(text: string): string[][] {
  // Rebuild wrapped prose: a line continues on the next one only when it clearly isn't finished
  // (ends with a comma/hyphen/"and"/"with"/"my"…) or the next line starts in lowercase. Titles, companies,
  // dates and list items stay on their own lines.
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const UNFINISHED = /(?:[,&(\-–]|\b(?:and|or|of|the|to|for|with|in|a|an|my|our|at|by|on|as|is|are|from|into|that|which|while|using|including|I'm|I am))$/i;
  const paragraphs: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (!line || BULLET_RE.test(line)) {
      if (cur) paragraphs.push(cur);
      cur = line ? line : '';
      continue;
    }
    const last = cur.split('\n').pop() ?? '';
    const continues = Boolean(last) && (UNFINISHED.test(last) || /^[a-z(]/.test(line));
    cur = continues ? `${cur}${/-$/.test(cur) ? '' : ' '}${line}` : cur ? `${cur}\n${line}` : line;
  }
  if (cur) paragraphs.push(cur);
  return paragraphs.map((p) =>
    p
      .replace(/([a-z]{2})\.([A-Z][a-z])/g, '$1. $2') // "impact.Alongside" -> "impact. Alongside"
      .split(/\n|(?<=[A-Za-z0-9)]{2}[.!?])\s+(?=[A-Z])/)
      .map((s) => s.replace(BULLET_RE, '').replace(/^(description|impact|responsibilities|role|details|summary)\s*[:\-–]\s*/i, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
}

function usable(s: string): boolean {
  const n = words(s).length;
  if (n < 6 || n > 45) return false;
  if (/@|https?:\/\/|www\.|\+?\d[\d\s-]{8,}\d/.test(s)) return false;
  const d = findDates(s);
  if (d && words(d.rest).length < 6) return false;
  return true;
}

// Words too generic to identify a company or project ("Institute" would match every college).
const GENERIC = new Set(
  `solution solutions private limited software technologies technology system systems application applications project projects institute institution
  training testing services service group india global international company consulting academy university college school center centre labs
  development developer engineering management web online digital data cloud smart app apps tool tools platform portal website tech infotech
  industries enterprises ventures studio studios media foundation agency corporation`.split(/\s+/),
);

/** Distinctive words of a company/project name: "Amshuhu iTech Solution" -> ["amshuhu", "itech"]. */
function nameTokens(name: string): string[] {
  return normKey(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !GENERIC.has(t));
}

/** A sentence that is mostly the entry's own name/title is a header line, not a bullet. */
function onlyNames(sentence: string, names: string[]): boolean {
  const own = new Set(names.flatMap((n) => normKey(n).split(' ')));
  return normKey(sentence).split(' ').filter((w) => w && !own.has(w)).length < 4;
}

/** Every distinctive word of the name must appear ("Demo Freight" doesn't match "Demo Institute"). */
function mentions(sentence: string, tokens: string[]): boolean {
  const s = normKey(sentence);
  return tokens.length > 0 && tokens.every((t) => new RegExp(`\\b${t}\\b`).test(s));
}

/** Education or header-like lines ("X Institute - B.E. Computer Science") are never bullets. */
function looksLikeHeader(s: string): boolean {
  return (DEGREE_RE.test(s) || INSTITUTION_RE.test(s)) && !WORK_VERB.test(s) && !ACTION_START.test(s);
}

export function suggestBullets(content: ResumeContent, rawTexts: string[]): BulletSuggestion[] {
  const paragraphs = rawTexts.flatMap(sentencesOf);
  const existing = new Set(
    [...content.experience.flatMap((e) => e.description), ...content.projects.flatMap((p) => p.description)].map((s) => normKey(s)),
  );
  const out: BulletSuggestion[] = [];
  const claimed = new Set<string>();

  const collect = (tokens: string[], names: string[]): string[] => {
    const found: string[] = [];
    for (const para of paragraphs) {
      para.forEach((s, i) => {
        if (!mentions(s, tokens)) return;
        const group = [s];
        // Following sentences in the same paragraph that describe work ("I develop dashboards…").
        for (let j = i + 1; j < para.length && WORK_VERB.test(para[j]); j++) group.push(para[j]);
        for (const g of group) {
          if (!usable(g) || onlyNames(g, names) || looksLikeHeader(g)) continue;
          // "Full-Stack Developer at X, working with PHP, Node.js…" -> "Work with PHP, Node.js…"
          const bullet = depersonalize(g)
            .replace(/^(?:an?\s+)?[\p{L}\s/-]{3,60}\s+at\s+[^,]{2,60},\s*working\s+(with|on)\s+/iu, 'Work $1 ')
            .replace(/\s+,/g, ',')
            .replace(/^./, (c) => c.toUpperCase());
          const key = normKey(bullet);
          if (existing.has(key) || claimed.has(key) || found.some((f) => normKey(f) === key)) continue;
          found.push(bullet);
        }
      });
    }
    return found.slice(0, MAX_PER_ENTRY);
  };

  // Experience: newest entries first, so a company's text goes to its most recent role.
  content.experience.forEach((e, index) => {
    if (e.description.filter((d) => d.trim()).length >= NEEDS || !e.company) return;
    const sentences = collect(nameTokens(e.company), [e.company, e.jobTitle, e.location]);
    sentences.forEach((s) => claimed.add(normKey(s)));
    if (sentences.length) out.push({ section: 'experience', index, sentences });
  });
  content.projects.forEach((p, index) => {
    if (p.description.filter((d) => d.trim()).length >= NEEDS || !p.name) return;
    const sentences = collect(nameTokens(p.name), [p.name, ...p.technologies]);
    sentences.forEach((s) => claimed.add(normKey(s)));
    if (sentences.length) out.push({ section: 'projects', index, sentences });
  });
  return out;
}
