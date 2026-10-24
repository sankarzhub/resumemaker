import type { DocLine } from './docLines.js';
import { COMPANY_WORDS, DEGREE_RE, INSTITUTION_RE, TITLE_WORDS, findDates, isAllCaps, isBulletLine, smartTitleCase, stripIcons, words } from './patterns.js';

export type SectionKey = 'summary' | 'experience' | 'education' | 'projects' | 'skills' | 'certifications' | 'contact' | 'personal' | 'additional';

export interface SectionMatch {
  key: SectionKey;
  /** Display title for "additional" sections, e.g. "Achievements". */
  title: string;
  /** Strong headings are recognised even without bold/caps styling. */
  strong: boolean;
}

interface Rule {
  key: SectionKey;
  title: string;
  strong?: RegExp;
  weak?: RegExp;
  /** When this matches, it decides the section outright. */
  exclusive?: boolean;
}

// Order matters only for ties at the same position; otherwise the keyword that appears first wins
// ("Skills & Certifications" -> skills, "Certifications & Training" -> certifications).
const RULES: Rule[] = [
  { key: 'skills', title: 'Skills', strong: /\b(programming|technical|computer|software|coding|scripting)\s+(languages?|skills?|knowledge|proficiency)\b/, exclusive: true },
  { key: 'summary', title: 'Summary', strong: /\b(summary|objective|profile|about me|career overview|professional overview)\b/, weak: /\b(about|overview|introduction)\b/ },
  { key: 'experience', title: 'Experience', strong: /\b(experience|experiences|employment|work history|career history|internships?|professional background)\b/, weak: /\b(work|career|positions held)\b/ },
  { key: 'education', title: 'Education', strong: /\b(education|educational|academics?|academic (background|qualifications?|details|profile|record|credentials)|qualifications?|scholastic)\b/ },
  { key: 'projects', title: 'Projects', strong: /\bprojects?\b/, weak: /\bportfolio\b/ },
  { key: 'skills', title: 'Skills', strong: /\b(skills?|skill set|skillset|competenc(y|ies)|tech stack|technologies|expertise|proficienc(y|ies)|know-how)\b/, weak: /\b(tools|software|it knowledge)\b/ },
  { key: 'certifications', title: 'Certifications', strong: /\b(certifications?|certificates?|licen[cs]es?)\b/, weak: /\b(courses?|trainings?|moocs?|online courses)\b/ },
  { key: 'contact', title: 'Contact', strong: /^(contact|contact (details|information|info)|get in touch)$/ },
  { key: 'personal', title: 'Personal Details', strong: /\b(personal (details|information|profile|data|info|particulars)|declaration|references?)\b/ },
  { key: 'additional', title: 'Achievements', strong: /\b(achievements?|accomplishments?|awards?|honou?rs|recognitions?)\b/ },
  { key: 'additional', title: 'Activities', strong: /\b(activities|extra[- ]?curricular|co[- ]?curricular|positions? of responsibility|volunteer(ing)?|community service|social work)\b/, weak: /\b(leadership|clubs?|community)\b/ },
  { key: 'additional', title: 'Languages', strong: /\b(languages? known|spoken languages?|languages)\b/ },
  { key: 'additional', title: 'Publications', strong: /\b(publications?|papers? published|patents?)\b/, weak: /\b(research|papers?)\b/ },
  { key: 'additional', title: 'Workshops & Seminars', strong: /\b(workshops?|seminars?|conferences?|webinars?)( attended)?\b/ },
  { key: 'additional', title: 'Interests', strong: /\b(interests|hobbies|areas? of interest)\b/ },
  { key: 'additional', title: 'Strengths', strong: /\bstrengths?\b/ },
];

/** Strip icons, numbering and decoration; join letter-spaced headings ("E D U C A T I O N"). */
export function cleanHeadingText(raw: string): string {
  let t = stripIcons(raw)
    .replace(/^[#>*=_~|\-–—•·\d.)\s]+/, '')
    .replace(/[:|_=~\-–—•·]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = t.split(' ');
  if (tokens.length >= 4 && tokens.every((x) => x.length === 1 || x === '&')) t = tokens.join('').replace(/&/g, ' & ');
  return t;
}

// Every word a real section heading is made of. A line like "Java Basic Certification" contains a
// heading keyword but also other words, so it is content (a certification), not a heading.
const HEADING_VOCAB = new Set(
  `about academic academics accomplishments achievement achievements activities additional and areas area attended award awards background basic brief career certificate certificates certification
  certifications co-curricular coding community competencies competency computer contact core courses course coursework credentials curricular data declaration details education educational employment
  experience experiences expertise extra extra-curricular extracurricular field get history hobbies honors honours industrial info information interest interests internship internships it key know-how
  knowledge language languages leadership licence licences license licenses me moocs my objective of online other overview papers particulars patents personal portfolio positions profile proficiency
  proficiencies professional programming projects project publications published qualification qualifications recognition recognitions references reference relevant research responsibility scholastic
  selected seminars service set skill skills skillset social soft software spoken stack strengths strength summary technical technologies tech tools top touch training trainings undertaken volunteer
  volunteering webinars work workshops worked academic-projects honors-awards in & the`
    .split(/\s+/)
    .filter(Boolean),
);

function unknownHeadingWords(text: string): number {
  return words(text.toLowerCase().replace(/[^a-z&\s-]/g, ' ')).filter((w) => !HEADING_VOCAB.has(w)).length;
}

/**
 * Which section a heading names. Strong keywords beat weak ones. In a plain heading the last keyword is
 * the head noun ("Academic Projects" → projects, "Career Objective" → summary); in a combined heading the
 * first one leads ("Skills & Certifications" → skills).
 */
export function classifyHeading(text: string): SectionMatch | null {
  const t = text.toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  const hits: Array<{ idx: number; rule: Rule; strong: boolean }> = [];
  for (const rule of RULES) {
    for (const [re, strong] of [[rule.strong, true], [rule.weak, false]] as const) {
      if (!re) continue;
      const m = re.exec(t);
      if (!m) continue;
      if (rule.exclusive && strong) return { key: rule.key, title: rule.title, strong: true };
      hits.push({ idx: m.index + m[0].length, rule, strong });
    }
  }
  if (!hits.length) return null;
  const pool = hits.some((h) => h.strong) ? hits.filter((h) => h.strong) : hits;
  const combined = /\b(and|or)\b|[/,]/.test(t);
  const best = pool.reduce((a, b) => (combined ? (b.idx < a.idx ? b : a) : b.idx > a.idx ? b : a));
  return { key: best.rule.key, title: best.rule.title, strong: best.strong };
}

export interface HeadingContext {
  bodySize?: number;
  /** True when most body text is bold (then bold is not a heading signal). */
  bodyBold?: boolean;
}

function styled(line: DocLine, ctx: HeadingContext, text: string): boolean {
  return Boolean(
    line.heading ||
      (line.bold && !ctx.bodyBold) ||
      (line.size && ctx.bodySize && line.size >= ctx.bodySize * 1.12) ||
      isAllCaps(text) ||
      /:\s*$/.test(line.text),
  );
}

/** Is this line a section heading? Returns what kind, or null. */
export function detectHeading(line: DocLine, ctx: HeadingContext): SectionMatch | null {
  if (isBulletLine(line.text)) return null;
  const text = cleanHeadingText(line.text);
  if (!text || text.length > 50 || /[@\d]/.test(text) || /[.!?;]$/.test(line.text.trim())) return null;
  const n = words(text).length;
  if (n > 6 || /,/.test(text)) return null;
  // "Skills: Java, Python" is content, not a heading.
  if (/:\s*\S/.test(line.text) && !/:\s*$/.test(line.text)) return null;
  const match = classifyHeading(text);
  if (!match) return null;
  const isStyled = styled(line, ctx, text);
  // Heading lines are made of heading words. One extra word is fine on a styled line
  // ("UNIVERSITY PROJECTS", "Mini Projects"); more means it's content ("Java Basic Certification").
  const unknown = unknownHeadingWords(text);
  if (unknown > (isStyled && n >= 2 ? 1 : 0)) return null;
  // Bold job titles ("Software Engineer", "Training Coordinator") are entries, not headings: a heading that
  // is only a weak keyword must be made entirely of heading words, and a job-title word disqualifies it.
  if (!match.strong && unknown > 0) return null;
  if (unknown > 0 && TITLE_WORDS.test(text)) return null;
  if (match.strong && (n <= 4 || isStyled)) return match;
  if (!match.strong && isStyled && n <= 4) return match;
  return null;
}

/**
 * Headings the keyword list doesn't know ("PATENTS FILED", "SEMINARS") are still headings when they look
 * exactly like the document's other headings. They become additional sections instead of being merged
 * into whatever came before.
 */
function looksLikeUnknownHeading(line: DocLine, ctx: HeadingContext, signature: Signature | null, next: DocLine | undefined): boolean {
  if (!signature || isBulletLine(line.text)) return false;
  const text = cleanHeadingText(line.text);
  if (!text || /[@\d,.;!?]/.test(text) || words(text).length > 4) return false;
  if (TITLE_WORDS.test(text) || COMPANY_WORDS.test(text) || DEGREE_RE.test(text) || INSTITUTION_RE.test(text)) return false;
  if (!next || findDates(next.text) || findDates(line.text)) return false;
  const sig = signatureOf(line, ctx, text);
  return sig.caps === signature.caps && sig.bold === signature.bold && sig.big === signature.big && (sig.caps || sig.bold || sig.big);
}

interface Signature {
  caps: boolean;
  bold: boolean;
  big: boolean;
}

function signatureOf(line: DocLine, ctx: HeadingContext, text: string): Signature {
  return {
    caps: isAllCaps(text),
    bold: Boolean(line.bold && !ctx.bodyBold) || Boolean(line.heading),
    big: Boolean(line.size && ctx.bodySize && line.size >= ctx.bodySize * 1.12),
  };
}

export interface Section {
  key: SectionKey;
  title: string;
  lines: DocLine[];
}

export interface SplitResult {
  header: DocLine[];
  sections: Section[];
}

/** Sections whose entries often have ALL-CAPS/bold names that must not be mistaken for unknown headings. */
const ENTRY_SECTIONS = new Set<SectionKey>(['experience', 'education', 'projects', 'certifications']);

export function splitSections(lines: DocLine[], ctx: HeadingContext): SplitResult {
  const header: DocLine[] = [];
  const sections: Section[] = [];
  // Learn what this document's headings look like from the ones we recognise.
  const sigCounts = new Map<string, { sig: Signature; n: number }>();
  for (const l of lines) {
    const m = detectHeading(l, ctx);
    if (!m) continue;
    const sig = signatureOf(l, ctx, cleanHeadingText(l.text));
    const k = JSON.stringify(sig);
    sigCounts.set(k, { sig, n: (sigCounts.get(k)?.n ?? 0) + 1 });
  }
  const signature = [...sigCounts.values()].sort((a, b) => b.n - a.n)[0];
  const sig = signature && signature.n >= 2 ? signature.sig : null;

  let current: Section | null = null;
  lines.forEach((line, i) => {
    if (!line.text.trim()) return;
    const m = detectHeading(line, ctx);
    if (m) {
      current = { key: m.key, title: m.key === 'additional' ? m.title : m.title, lines: [] };
      sections.push(current);
      return;
    }
    const cur = current as Section | null;
    if (cur && !ENTRY_SECTIONS.has(cur.key) && cur.key !== 'skills' && looksLikeUnknownHeading(line, ctx, sig, lines[i + 1])) {
      current = { key: 'additional', title: smartTitleCase(cleanHeadingText(line.text)), lines: [] };
      sections.push(current);
      return;
    }
    if (cur) cur.lines.push(line);
    else header.push(line);
  });
  return { header, sections };
}
