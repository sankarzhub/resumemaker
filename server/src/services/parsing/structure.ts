import { emptyResumeContent, type ResumeContent } from '../../types/resume.js';
import { canonicalSkill, dedupeCaseInsensitive, isDictionarySkill } from '../skills.js';
import { ACTION_VERBS } from '../atsChecker.service.js';
import { bodyFontSize, type DocLine } from './docLines.js';
import {
  ACTION_START,
  COMPANY_WORDS,
  DEGREE_RE,
  INSTITUTION_RE,
  NATURAL_LANGUAGES,
  TITLE_WORDS,
  findDates,
  headlineCase,
  isAllCaps,
  isBulletLine,
  isLocation,
  nameCase,
  normalizeDate,
  smartTitleCase,
  stripBullet,
  stripIcons,
  words,
  type FoundDates,
} from './patterns.js';
import { detectHeading, splitSections, type HeadingContext, type Section } from './sections.js';

type Experience = ResumeContent['experience'][number];
type Education = ResumeContent['education'][number];
type Project = ResumeContent['projects'][number];

export interface StructureResult {
  content: ResumeContent;
  warnings: string[];
  detectedSections: string[];
  /** Things we deliberately left out or changed, shown to the user. */
  notes: string[];
}

export interface StructureOptions {
  /** LinkedIn "Save to PDF" export: company line comes before title, roles are grouped by company. */
  linkedin?: boolean;
}

// ---------- Line classification ----------

type Kind = 'date' | 'bullet' | 'label' | 'location' | 'sentence' | 'short';

interface Classified {
  text: string;
  kind: Kind;
  dates?: FoundDates;
  label?: { name: string; value: string };
  bold?: boolean;
  allCaps: boolean;
}

const LABEL_RE =
  /^(project title|project name|title|description|project description|details|summary|impact|result|results|outcome|outcomes|responsibilities|key responsibilities|role|my role|roles and responsibilities|achievements?|key achievements|highlights|features|key features|contribution|tech(?:nolog(?:y|ies))?(?: used)?|tech stack|technology stack|tools(?: used)?|tools & technologies|environment|platform|languages used|skills used|built with|stack|team size|duration|client|domain|link|url|github|demo|live)\s*[:\-–]\s*(.*)$/i;
const TECH_LABEL = /^(tech(?:nolog(?:y|ies))?(?: used)?|tech stack|technology stack|tools(?: used)?|tools & technologies|environment|platform|languages used|skills used|built with|stack)$/i;
const DROP_LABEL = /^(team size|duration|client|domain)$/i;
const URL_LABEL = /^(link|url|github|demo|live)$/i;

function classify(raw: DocLine): Classified {
  // Check for a bullet before removing icons: "➤ Built…" uses an icon-like glyph as its bullet.
  if (isBulletLine(raw.text)) {
    const t = stripIcons(stripBullet(raw.text));
    return { text: t, kind: 'bullet', bold: raw.bold, allCaps: isAllCaps(t) };
  }
  const text = stripIcons(raw.text).replace(/\s+/g, ' ').trim();
  const allCaps = isAllCaps(text);
  if (isBulletLine(text)) return { text: stripBullet(text), kind: 'bullet', bold: raw.bold, allCaps };
  const lm = text.match(LABEL_RE);
  if (lm) return { text, kind: 'label', label: { name: lm[1], value: lm[2].trim() }, bold: raw.bold, allCaps };
  const n = words(text).length;
  const dates = findDates(text);
  // A date counts as an entry anchor only on short lines; dates inside sentences are just content.
  if (dates && words(dates.rest).length <= 14 && !/[.!?]$/.test(dates.rest)) return { text, kind: 'date', dates, bold: raw.bold, allCaps };
  if (isLocation(text)) return { text, kind: 'location', bold: raw.bold, allCaps };
  const firstWord = (text.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const verbStart = ACTION_START.test(text) || ACTION_VERBS.has(firstWord);
  const sentence = n >= 13 || (/[.!?]$/.test(text) && n >= 4) || /^[a-z(]/.test(text) || (verbStart && n >= 2);
  return { text, kind: sentence ? 'sentence' : 'short', bold: raw.bold, allCaps };
}

const isBody = (c: Classified) => c.kind === 'bullet' || c.kind === 'label' || c.kind === 'sentence';

/** Append a line to a list of bullet texts, joining wrapped continuations. */
function pushText(list: string[], text: string, isNewBullet: boolean) {
  const t = text.trim();
  if (!t) return;
  const last = list.length - 1;
  const continues = last >= 0 && !isNewBullet && (/^[a-z0-9(&,]/.test(t) || /[,&(\-–]$/.test(list[last]) || /\b(and|or|of|the|to|for|with|in|a|an)$/i.test(list[last]));
  if (continues) list[last] = `${list[last]} ${t}`.replace(/\s+/g, ' ');
  else list.push(t);
}

// ---------- Title / company / location from header lines ----------

const EMPLOYMENT_TYPE = /^(full[- ]?time|part[- ]?time|internship|intern|contract|contractual|freelance|temporary|permanent|self[- ]employed|apprenticeship|trainee)$/i;

function splitParts(line: string): string[] {
  return line
    .split(/\s+\|\s+|\s*\|\s*|\s+[-–—]\s+|\s+[-–—](?=\S)|(?<=\S)[-–—]\s+|\s+@\s+|\s+at\s+|\s*·\s*/)
    .map((p) => p.replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim())
    .filter(Boolean);
}

function titleScore(s: string) {
  return (TITLE_WORDS.test(s) ? 2 : 0) + (/^(senior|junior|sr\.?|jr\.?|lead|chief|head|associate|assistant|trainee)\b/i.test(s) ? 1 : 0) - (COMPANY_WORDS.test(s) ? 2 : 0);
}

function assignTitleCompany(headerLines: string[], linkedin: boolean): { jobTitle: string; company: string; location: string; extra: string[] } {
  let location = '';
  const extra: string[] = [];
  // Pull out trailing ", City, State" pieces and stand-alone locations first.
  const cleaned = headerLines
    .map((h) => {
      const m = h.match(/^(.*?)(?:,\s*|\s+[|–—-]\s+)([\p{Lu}][\p{L}.' -]+(?:,\s*[\p{Lu}][\p{L}.' -]+){0,2})$/u);
      if (m && isLocation(m[2]) && words(m[1]).length >= 1) {
        location ||= m[2].trim();
        return m[1].trim();
      }
      return h;
    })
    .filter((h) => {
      if (isLocation(h)) {
        location ||= h;
        return false;
      }
      return true;
    });

  if (linkedin && cleaned.length >= 2) {
    return { company: cleaned[0], jobTitle: cleaned[1], location, extra: cleaned.slice(2) };
  }

  let parts = cleaned.flatMap((h) => {
    const p = splitParts(h);
    // "Software Engineer, Google" (one comma, both sides short) is title + company.
    if (p.length === 1 && (h.match(/,/g) ?? []).length === 1) {
      const [a, b] = h.split(/\s*,\s*/);
      if (words(a).length <= 5 && words(b).length <= 5) return [a, b];
    }
    return p;
  });
  parts = parts.filter((p) => {
    if (EMPLOYMENT_TYPE.test(p)) return false;
    if (isLocation(p)) {
      location ||= p;
      return false;
    }
    return true;
  });
  if (parts.length === 0) return { jobTitle: '', company: '', location, extra };
  if (parts.length === 1) {
    const p = parts[0];
    return titleScore(p) >= 1 || !COMPANY_WORDS.test(p) ? { jobTitle: p, company: '', location, extra } : { jobTitle: '', company: p, location, extra };
  }
  const scored = parts.map((p, i) => ({ p, i, s: titleScore(p) }));
  const title = [...scored].sort((a, b) => b.s - a.s || a.i - b.i)[0];
  const rest = scored.filter((x) => x !== title);
  const company = [...rest].sort((a, b) => a.s - b.s || a.i - b.i)[0];
  for (const x of rest) if (x !== company) extra.push(x.p);
  // With no signal either way, the first part is the title only if the second looks like a company.
  if (title.s === company.s && title.i > company.i) return { jobTitle: company.p, company: title.p, location, extra };
  return { jobTitle: title.p, company: company.p, location, extra };
}

// ---------- Experience ----------

export function parseExperience(lines: DocLine[], opts: StructureOptions): Experience[] {
  const ls = lines.map(classify).filter((c) => c.text);
  const anchors = ls.map((c, i) => (c.kind === 'date' ? i : -1)).filter((i) => i >= 0);
  const entries: Experience[] = [];
  const fresh = (): Experience => ({ company: '', jobTitle: '', location: '', startDate: '', endDate: '', current: false, description: [] });

  const fillBody = (e: Experience, body: Classified[]) => {
    for (const c of body) {
      if (c.kind === 'label') {
        const { name, value } = c.label!;
        if (DROP_LABEL.test(name) || URL_LABEL.test(name)) continue;
        if (TECH_LABEL.test(name)) pushText(e.description, `Technologies: ${value}`, true);
        else pushText(e.description, value, true);
      } else pushText(e.description, c.text, c.kind === 'bullet');
    }
  };

  if (anchors.length === 0) {
    // Dateless entries: a short header line (or two) followed by body lines.
    let cur: Experience | null = null;
    let header: string[] = [];
    let body: Classified[] = [];
    const close = () => {
      if (!cur) return;
      Object.assign(cur, pick(assignTitleCompany(header, Boolean(opts.linkedin))));
      fillBody(cur, body);
      entries.push(cur);
    };
    for (const c of ls) {
      if ((c.kind === 'short' || c.kind === 'location') && (!cur || body.length > 0)) {
        if (cur && body.length) {
          close();
          cur = null;
        }
        if (!cur) {
          cur = fresh();
          header = [];
          body = [];
        }
        header.push(c.text);
      } else {
        if (!cur) {
          cur = fresh();
          header = [];
          body = [];
        }
        body.push(c);
      }
    }
    close();
    return entries.filter((e) => e.jobTitle || e.company || e.description.length);
  }

  // Is the date written before the title (date-first) or after it (header-first)?
  const first = anchors[0];
  const dateFirst = !ls.slice(0, first).some((c) => c.kind === 'short') && !ls[first].dates!.rest;

  // Entry spans.
  const starts: number[] = [];
  for (const a of anchors) {
    if (dateFirst) {
      starts.push(a);
      continue;
    }
    let s = a;
    const prev = starts.length ? anchors[starts.length - 1] : -1;
    // Walk back over this entry's header lines (company/title/location), at most 3, never into the
    // previous entry's date line or past a body line.
    // A location right after the previous entry's date belongs to that entry (LinkedIn: title, dates, location).
    while (s - 1 > prev && (ls[s - 1].kind === 'short' || ls[s - 1].kind === 'location') && a - s < 3 && !(ls[s - 1].kind === 'location' && s - 2 === prev)) s--;
    starts.push(s);
  }
  if (starts[0] > 0) {
    // Lines before the first entry: a header for it (date-first layouts) or stray content.
    if (!dateFirst) starts[0] = 0;
  }

  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : ls.length;
    const span = ls.slice(dateFirst && k === 0 ? 0 : start, end);
    const e = fresh();
    const header: string[] = [];
    let i = 0;
    let headerLong = 0;
    // Meta zone: header lines, the date, locations, until the first body line.
    for (; i < span.length; i++) {
      const c = span[i];
      if (c.kind === 'date' && !e.startDate) {
        e.startDate = c.dates!.start;
        e.endDate = c.dates!.end;
        e.current = c.dates!.current;
        if (c.dates!.rest) header.push(c.dates!.rest);
        continue;
      }
      if (c.kind === 'location') {
        // "Demo Studio, Chennai" under a title with no company yet: company + city.
        const parts = c.text.split(/\s*,\s*/);
        if (!e.company && parts.length >= 2 && !isLocation(parts[0]) && header.length <= 1 && !header.some((h) => COMPANY_WORDS.test(h))) {
          header.push(parts[0]);
          e.location ||= parts.slice(1).join(', ');
        } else e.location ||= c.text;
        continue;
      }
      if (c.kind === 'short' && header.length < 3) {
        header.push(c.text);
        continue;
      }
      // Date-first layouts: the first line after the date is the title line even when it's long.
      if (dateFirst && header.length === 0 && c.kind === 'sentence' && !/[.!?]$/.test(c.text) && words(c.text).length <= 16 && headerLong === 0) {
        header.push(c.text);
        headerLong++;
        continue;
      }
      break;
    }
    const tc = assignTitleCompany(header, Boolean(opts.linkedin));
    e.jobTitle = tc.jobTitle;
    e.company = tc.company;
    e.location ||= tc.location;
    for (const x of tc.extra) pushText(e.description, x, true);
    fillBody(e, span.slice(i));
    // LinkedIn groups several roles under one company line; later roles inherit it.
    if (opts.linkedin && !e.company && e.jobTitle && entries.length) e.company = entries[entries.length - 1].company;
    entries.push(e);
  });
  return entries.filter((e) => e.jobTitle || e.company || e.description.length);
}

function pick(x: { jobTitle: string; company: string; location: string }) {
  return { jobTitle: x.jobTitle, company: x.company, location: x.location };
}

// ---------- Education ----------

const GRADE_RE = /\b(c\.?g\.?p\.?a|s\.?g\.?p\.?a|g\.?p\.?a|cgpa|percentage|percent|aggregate|marks|score|grade|result)\s*[:\-–]?\s*(\d+(?:\.\d+)?\s*(?:\/\s*\d+(?:\.\d+)?|%)?)/i;
// "8.1 CGPA", "92%", "8.4/10", "3.7 GPA"
const GRADE_AFTER_RE = /(?<![\w.])(\d{1,3}(?:\.\d{1,2})?)\s*(%|\/\s*10\b|\/\s*4(?:\.0)?\b|c\.?g\.?p\.?a\b|g\.?p\.?a\b)/i;
const BOARD_RE = /^(state board|cbse|icse|igcse|ib|matriculation( board)?|board of [\w ]+|[\w ]*board)$/i;
const TABLE_HEADER_RE = /^(degree|course|qualification|institution|institute|college|school|university|board|year|year of passing|passing year|percentage|cgpa|marks|grade|score|specialization|stream)(\s*[|/,]?\s*(degree|course|qualification|institution|institute|college|school|university|board|year|year of passing|passing year|percentage|cgpa|marks|grade|score|specialization|stream))*$/i;

export function parseEducation(lines: DocLine[]): Education[] {
  const entries: Education[] = [];
  let cur: Education | null = null;
  const fresh = (): Education => ({ institution: '', degree: '', field: '', location: '', startDate: '', endDate: '', grade: '' });
  const start = () => {
    cur = fresh();
    entries.push(cur);
    return cur;
  };

  for (const raw of lines) {
    // LinkedIn: "Bachelor of Engineering - BE, Computer Science · (2016 - 2020)"; keep "B.E (CSE)" intact.
    let text = stripBullet(stripIcons(raw.text))
      .replace(/\s*·\s*/g, ' | ')
      .replace(/\(\s*([^()]*\d{4}[^()]*)\)/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || TABLE_HEADER_RE.test(text)) continue;
    const dates = findDates(text);
    const hasDegree = DEGREE_RE.test(text);
    const hasInst = INSTITUTION_RE.test(text);
    let e = cur as Education | null;

    // Start a new entry when this line repeats a field the current entry already has.
    if (!e || (hasDegree && e.degree) || (hasInst && !hasDegree && e.institution) || (dates && !dates.rest && (e.startDate || e.endDate) && (e.degree || e.institution))) {
      e = start();
    }
    if (dates) {
      if (dates.end || dates.current) {
        e.startDate = dates.start;
        e.endDate = dates.current ? 'Present' : dates.end;
      } else e.endDate = dates.start;
      text = dates.rest;
    }
    const g = text.match(GRADE_RE);
    const ga = !g ? text.match(GRADE_AFTER_RE) : null;
    if (g) {
      e.grade = `${/c\.?g\.?p\.?a/i.test(g[1]) ? 'CGPA' : /g\.?p\.?a/i.test(g[1]) ? 'GPA' : smartTitleCase(g[1].charAt(0).toUpperCase() + g[1].slice(1).toLowerCase())}: ${g[2].replace(/\s+/g, '')}`;
      text = text.replace(g[0], ' ').replace(/\s+/g, ' ').trim();
    } else if (ga) {
      const unit = ga[2].replace(/\s+/g, '').toLowerCase();
      e.grade = unit === '%' ? `${ga[1]}%` : /^\//.test(unit) ? `CGPA: ${ga[1]}${ga[2].replace(/\s+/g, '')}` : `${/c/.test(unit) ? 'CGPA' : 'GPA'}: ${ga[1]}`;
      text = text.replace(ga[0], ' ').replace(/\s+/g, ' ').trim();
    }
    text = text.replace(/^[|,–—:\-\s]+|[|,–—:\-\s]+$/g, '');
    if (!text) continue;
    const spec = text.match(/^(?:specialization|specialisation|major|branch|stream|field)\s*[:\-–]\s*(.+)$/i);
    if (spec) {
      e.field ||= spec[1].trim();
      continue;
    }

    const parts = text
      .split(/\s+\|\s+|\s*\|\s*|\s+[-–—]\s+|\s+[-–—](?=\S)|(?<=\S)[-–—]\s+/)
      .flatMap((p) => (DEGREE_RE.test(p) && INSTITUTION_RE.test(p) ? p.split(/\s*,\s*/) : [p]))
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (BOARD_RE.test(part)) continue;
      if (isLocation(part) && !DEGREE_RE.test(part)) {
        e.location ||= part;
        continue;
      }
      if (DEGREE_RE.test(part) && !e.degree) {
        // "B.E. in Computer Science" / "Bachelor of Science in Physics" -> degree + field.
        const m = part.match(/^(.*?)\s+in\s+(.+)$/i);
        if (m && DEGREE_RE.test(m[1])) {
          e.degree = m[1].trim();
          e.field ||= m[2].trim();
        } else e.degree = part;
        continue;
      }
      // LinkedIn: "Bachelor of Engineering - BE, Computer Science" -> field after the abbreviation.
      if (e.degree && !e.field && /^[A-Z][A-Za-z.]{0,6}\s*,\s*\S/.test(part) && !INSTITUTION_RE.test(part)) {
        e.field = part.replace(/^[A-Z][A-Za-z.]{0,6}\s*,\s*/, '').trim();
        continue;
      }
      if (INSTITUTION_RE.test(part) || (!e.institution && e.degree && COMPANY_WORDS.test(part))) {
        if (!e.institution) {
          const [inst, loc] = part.split(/,\s*(?=[\p{Lu}][\p{L} .'-]+$)/u);
          e.institution = inst.trim();
          if (loc && isLocation(loc)) e.location ||= loc.trim();
        }
        continue;
      }
      // A plain line after the degree is usually the field of study ("Computer Science and Engineering").
      if (e.degree && !e.field && words(part).length <= 8 && !/\d/.test(part)) {
        e.field = part;
        continue;
      }
      if (!e.institution && e.degree) {
        e.institution = part;
        continue;
      }
      if (!e.degree) e.degree = part;
    }
  }
  return entries.filter((e) => e.institution || e.degree);
}

// ---------- Projects ----------

export function parseProjects(lines: DocLine[]): Project[] {
  const ls = lines.map(classify).filter((c) => c.text);
  const projects: Project[] = [];
  let cur: Project | null = null;
  let hasBody = false;
  const start = (name: string) => {
    cur = { name: '', description: [], technologies: [], url: '' };
    projects.push(cur);
    hasBody = false;
    setName(cur, name);
  };
  const setName = (p: Project, raw: string) => {
    const url = raw.match(/(https?:\/\/\S+|(?:www\.)?github\.com\/\S+)/i)?.[1];
    if (url) p.url ||= url;
    let name = raw.replace(url ?? '', ' ');
    const d = findDates(name);
    if (d) name = d.rest;
    const tech = name.match(/\(([^)]+)\)\s*$/) ?? name.match(/\s(?:\||–|—|-)\s(.+)$/);
    if (tech && (tech[1].includes(',') || isDictionarySkill(tech[1].trim()))) {
      addTech(p, tech[1]);
      name = name.replace(tech[0], ' ');
    }
    p.name = smartTitleCase(name.replace(/^(project\s*(title|name)?\s*[:\-–]\s*)/i, '').replace(/[|,–—()\-:\s]+$/, '').trim());
  };
  const addTech = (p: Project, list: string) => {
    for (const t of list.split(/\s*[,|/;•·]\s*|\s+and\s+/)) {
      const s = t.replace(/[.]$/, '').trim();
      if (s && words(s).length <= 4) p.technologies.push(canonicalSkill(s));
    }
    p.technologies = dedupeCaseInsensitive(p.technologies);
  };

  ls.forEach((c, i) => {
    const next = ls[i + 1];
    if (c.kind === 'label') {
      const { name, value } = c.label!;
      if (/^(project\s*)?(title|name)$/i.test(name)) return start(value);
      if (!cur) start('');
      const p = cur!;
      if (TECH_LABEL.test(name)) addTech(p, value);
      else if (URL_LABEL.test(name)) p.url ||= value;
      else if (!DROP_LABEL.test(name)) {
        pushText(p.description, value, true);
        hasBody = true;
      }
      return;
    }
    const p0 = cur as Project | null;
    const headerish = (c.kind === 'short' || c.kind === 'date' || (c.kind === 'location' && c.allCaps)) && words(c.text).length <= 12;
    const nextIsBody = Boolean(next && (next.kind === 'bullet' || next.kind === 'label' || next.kind === 'sentence'));
    // A new project starts at a title-like line: the first one, one after the previous project's body
    // (styled, or followed by its own body), or an unnamed project's first short line.
    if (headerish && (!p0 || (hasBody && (c.allCaps || c.bold || nextIsBody)) || (!p0.name && !hasBody))) {
      if (p0 && !p0.name && !hasBody) return setName(p0, c.text);
      return start(c.text);
    }
    if (!cur) start('');
    const p = cur!;
    // A short line right under the name listing known technologies: "React, Node.js, MongoDB".
    if (!hasBody && c.kind === 'short' && c.text.split(/\s*[,|/]\s*/).every((t) => isDictionarySkill(t))) {
      addTech(p, c.text);
      return;
    }
    if (/^(https?:\/\/|www\.|github\.com\/)/i.test(c.text)) {
      p.url ||= c.text;
      return;
    }
    pushText(p.description, c.text, c.kind === 'bullet');
    hasBody = true;
  });
  return projects
    .filter((p) => p.name || p.description.length)
    .map((p) => ({ ...p, name: p.name || 'Project' }));
}

// ---------- Skills ----------

export function parseSkills(lines: DocLine[]): { skills: string[]; languages: string[] } {
  const skills: string[] = [];
  const languages: string[] = [];
  for (const raw of lines) {
    const line = stripBullet(stripIcons(raw.text));
    if (!line) continue;
    const m = line.match(/^([^:]{2,40}):\s*(.*)$/);
    const label = m ? m[1].toLowerCase() : '';
    const body = m ? m[2] : line;
    const isSpoken = /language/.test(label) && !/(programming|coding|scripting|computer)/.test(label);
    const tokens = body
      .replace(/\b(fluent|proficient|native|basic|intermediate|advanced|good|working knowledge)\s+(in|of)\s+/gi, '')
      .split(/\s*[,;|•·●▪✓✔➤►◆★☆→]\s*|\s{2,}|\s+and\s+(?=[A-Z])/)
      // "HTML5/CSS3" splits; "CI/CD", "A/B Testing", "UI/UX" (known, or one side a single letter) stay whole.
      .flatMap((t) => (/\//.test(t) && !isDictionarySkill(t) && t.split('/').every((x) => x.trim().length >= 2) ? t.split('/') : [t]))
      .map((t) => t.replace(/^(and|&)\s+/i, '').replace(/\s*\((?:basic|intermediate|advanced|beginner|expert)\)$/i, '').replace(/[.]+$/, '').trim())
      .filter((t) => t && !/^etc\.?$/i.test(t));
    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (NATURAL_LANGUAGES.has(lower)) {
        languages.push(smartTitleCase(t.charAt(0).toUpperCase() + t.slice(1)));
        continue;
      }
      // "Languages: Java, Python" lists programming languages; only drop unknown words under a spoken-language label.
      if (isSpoken && !isDictionarySkill(t)) continue;
      if (words(t).length > 5 || t.length > 45) continue;
      skills.push(canonicalSkill(t));
    }
  }
  return { skills: dedupeCaseInsensitive(skills), languages: dedupeCaseInsensitive(languages) };
}

// ---------- Certifications & additional sections ----------

export function parseCertifications(lines: DocLine[], opts: StructureOptions = {}): ResumeContent['certifications'] {
  const items: string[] = [];
  for (const raw of lines) {
    const c = classify(raw);
    const prev = items[items.length - 1];
    // LinkedIn's narrow sidebar wraps long names (~35 characters): a short line right after a
    // full-width line continues it, unless it reads like a certification name on its own.
    const standalone = /certif|course|program|exam|associate|professional|developer|administrator|practitioner|specialist|fundamentals/i.test(c.text);
    if (opts.linkedin && prev && prev.length >= 33 && words(c.text).length <= 3 && !standalone && !findDates(c.text)) {
      items[items.length - 1] = `${prev} ${c.text}`;
      continue;
    }
    pushText(items, c.text, c.kind === 'bullet');
  }
  return items.map((l) => {
    const d = findDates(l);
    let rest = d ? d.rest : l;
    const urlM = rest.match(/(https?:\/\/\S+)/);
    if (urlM) rest = rest.replace(urlM[0], ' ').trim();
    let name = rest;
    let issuer = '';
    const paren = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const split = rest.match(/^(.*?)\s+(?:[-–—|]|by|from|issued by)\s+(.+)$/i);
    if (paren) [name, issuer] = [paren[1], paren[2]];
    else if (split) [name, issuer] = [split[1], split[2]];
    // "JPMorgan Chase & Co. - Excel Skills": the organisation part is the issuer.
    const ORG_END = /\b(co\.?|inc\.?|ltd\.?|llc|corp\.?|corporation|limited|technologies|university|institute|academy|foundation|google|microsoft|amazon|aws|ibm|oracle|cisco|meta|infosys|coursera|udemy|nptel|edx)$/i;
    const CERT_TITLE = /\b(skills?|certif\w*|course|program(me)?|simulation|fundamentals|basics|essentials|practitioner|associate|professional|specialization|bootcamp|training|foundations?)\b/i;
    if (issuer && ORG_END.test(name.trim()) && CERT_TITLE.test(issuer) && !CERT_TITLE.test(name) && words(name).length <= 5) [name, issuer] = [issuer, name];
    return { name: name.replace(/[,|–—\-:.\s]+$/, '').trim(), issuer: issuer.replace(/[,.\s]+$/, '').trim(), date: d ? d.start : '', url: urlM?.[1] ?? '' };
  }).filter((c) => c.name.length > 2);
}

function parseItems(lines: DocLine[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const c = classify(raw);
    // "NSS VOLUNTEER: Event committee member" -> "NSS Volunteer: Event committee member"
    const text = c.text.replace(/^([^:]{2,40}):/, (_, label: string) => `${smartTitleCase(label)}:`);
    pushText(items, smartTitleCase(text), c.kind === 'bullet' || c.kind === 'label' || c.kind === 'short');
  }
  return items;
}

// ---------- Contact & header ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}(?!\d)/g;
const URL_RE = /((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|io|dev|me|net|org|co|app|site|tech|ai|xyz|info|page|link|us|uk)(?:\/[^\s,|()]*)?)/gi;
const NAME_RE = /^[\p{Lu}][\p{L}.'’-]*(?:\s+[\p{L}][\p{L}.'’-]*){0,4}$/u;

function findPhone(text: string): string {
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    if (/^(19|20)\d{2}(19|20)\d{2}$/.test(digits)) continue; // "2016 2020"
    return m[0].trim();
  }
  return '';
}

const NOT_A_NAME = /\b(curriculum|vitae|resume|résumé|cv|bio-?data|profile|portfolio|contact|summary|confidential)\b/i;

function looksLikeName(s: string): boolean {
  const t = s.trim();
  return (
    NAME_RE.test(t) &&
    words(t).length <= 5 &&
    !NOT_A_NAME.test(t) &&
    !TITLE_WORDS.test(t) &&
    !COMPANY_WORDS.test(t) &&
    !isLocation(t) &&
    !isDictionarySkill(t) &&
    !/[|@\d]/.test(t) &&
    !detectHeading({ text: t }, {})
  );
}

function fillContact(content: ResumeContent, text: string) {
  const p = content.personalInfo;
  p.email ||= text.match(EMAIL_RE)?.[0] ?? '';
  p.phone ||= findPhone(text.replace(EMAIL_RE, ' '));
  for (const m of text.matchAll(URL_RE)) {
    const url = m[1];
    const idx = m.index ?? 0;
    if (text[idx - 1] === '@' || text[idx + url.length] === '@' || /@/.test(url)) continue;
    if (/linkedin\.com/i.test(url)) p.linkedin ||= url.replace(/[).,]+$/, '');
    else if (/github\.com/i.test(url)) p.github ||= url.replace(/[).,]+$/, '');
    else if (
      !p.portfolio &&
      !/(gmail|yahoo|outlook|hotmail|rediffmail)\./i.test(url) &&
      // "B.Tech", "M.Sc" etc. look like domains; real links have a path, www/http, or a site-style TLD.
      /^[a-z0-9-]{2,}\./i.test(url.replace(/^https?:\/\/(www\.)?|^www\./i, '')) &&
      /^https?:\/\/|^www\.|\/\w|\.(dev|io|me|app|site|page)$/i.test(url)
    )
      p.portfolio = url.replace(/[).,]+$/, '');
  }
}

// ---------- Orchestration ----------

const PERSONAL_DETAIL_RE = /^(date of birth|d\.?o\.?b|dob|age|gender|sex|marital status|nationality|religion|caste|father'?s? name|mother'?s? name|blood group|passport|aadhaa?r|pan|permanent address|address|place|date|declaration|signature)\b/i;

export function structureLines(input: DocLine[], opts: StructureOptions = {}): StructureResult {
  const content = emptyResumeContent();
  const warnings: string[] = [];
  const notes: string[] = [];
  const lines = input.map((l) => ({ ...l, text: l.text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim() })).filter((l) => l.text);
  const bodySize = bodyFontSize(lines);
  const boldChars = lines.reduce((a, l) => a + (l.bold ? l.text.length : 0), 0);
  const ctx: HeadingContext = { bodySize, bodyBold: boldChars > lines.reduce((a, l) => a + l.text.length, 0) * 0.6 };

  const { header, sections } = splitSections(lines, ctx);
  relocateNameBlock(lines, header, sections, bodySize, opts);

  const byKey = (k: Section['key']) => sections.filter((s) => s.key === k).flatMap((s) => s.lines);
  const detected = new Set(sections.map((s) => s.key).filter((k) => !['contact', 'personal', 'additional'].includes(k)));

  // Contact details: header, contact section, then anywhere near the top, then the whole document.
  const headerText = header.map((l) => l.text).join('\n');
  const contactText = byKey('contact').map((l) => l.text).join('\n');
  const allText = lines.map((l) => l.text).join('\n');
  fillContact(content, `${headerText}\n${contactText}`);
  fillContact(content, lines.slice(0, 25).map((l) => l.text).join('\n'));
  fillContact(content, allText);

  // Name: the biggest text near the top (PDF), else the first name-like header line.
  const p = content.personalInfo;
  const firstPage = lines.filter((l) => (l.page ?? 1) === 1);
  const maxSize = Math.max(0, ...firstPage.map((l) => l.size ?? 0));
  const bigName = bodySize && maxSize >= bodySize * 1.3 ? firstPage.find((l) => (l.size ?? 0) >= maxSize - 0.5 && looksLikeName(stripIcons(l.text))) : undefined;
  const nameLine = bigName ?? header.find((l) => looksLikeName(stripIcons(l.text)));
  if (nameLine) p.fullName = nameCase(stripIcons(nameLine.text));
  else warnings.push('Could not detect your name. Please add it.');

  // Headline and location from the header (and a contact section, if any).
  for (const l of [...header, ...byKey('contact')]) {
    if (l === nameLine) continue;
    const t = stripIcons(l.text);
    const segments = t.split(/\s*[|•·]\s*|\s{3,}/).map((x) => x.trim()).filter(Boolean);
    for (const part of segments) {
      if (!p.location && isLocation(part)) p.location = part;
    }
    // "Product Designer | email | phone" -> the first segment is the headline.
    const first = segments[0] ?? '';
    if (!content.targetJobTitle && header.includes(l) && !/^\W/.test(first) && !EMAIL_RE.test(first) && TITLE_WORDS.test(first) && words(first).length <= 7 && !findDates(first) && !looksLikeName(first)) {
      content.targetJobTitle = first.split(/\s+at\s+|\s*,\s*/)[0].trim();
    }
  }
  if (!p.location) {
    const addr = [...header, ...byKey('contact'), ...byKey('personal')].map((l) => l.text).find((t) => /^(address|location|city|residence)\s*[:\-]/i.test(t));
    if (addr) {
      const parts = addr.replace(/^[^:\-]*[:\-]\s*/, '').split(/\s*,\s*/).map((x) => x.replace(/\s*-?\s*\d{5,6}\s*$/, '').trim()).filter((x) => x && !/\d/.test(x));
      p.location = parts.slice(-2).join(', ');
    }
  }

  // Summary: its own section, or a paragraph in the header.
  content.summary = joinParagraph(byKey('summary'));
  if (!content.summary) {
    const para = header.filter((l) => words(l.text).length >= 8 && !EMAIL_RE.test(l.text) && l !== nameLine);
    if (words(para.map((l) => l.text).join(' ')).length >= 20) content.summary = joinParagraph(para);
  }

  const sk = parseSkills(byKey('skills'));
  content.skills = sk.skills;
  content.experience = parseExperience(byKey('experience'), opts);
  content.education = parseEducation(byKey('education'));
  content.projects = parseProjects(byKey('projects'));
  content.certifications = parseCertifications(byKey('certifications'), opts);

  // Additional sections keep everything else the candidate wrote.
  const additional = new Map<string, string[]>();
  for (const s of sections.filter((x) => x.key === 'additional')) {
    const spoken = s.title === 'Languages' ? parseSkills(s.lines).languages : [];
    const items = spoken.length ? spoken : parseItems(s.lines);
    additional.set(s.title, [...(additional.get(s.title) ?? []), ...items]);
  }
  // Spoken languages can also hide in a personal-details block ("Languages Known : English, Tamil").
  const personalLangs = parseSkills([...byKey('personal'), ...header].filter((l) => /^\s*languages?(\s+known)?\s*[:\-–]/i.test(l.text))).languages;
  const langs = [...sk.languages, ...personalLangs];
  if (langs.length) additional.set('Languages', dedupeCaseInsensitive([...(additional.get('Languages') ?? []), ...langs]));
  content.additionalSections = [...additional].map(([title, items]) => ({ title, items: dedupeCaseInsensitive(items) })).filter((s) => s.items.length);

  // Personal details (date of birth, marital status, declaration…) are left out on purpose.
  const personal = byKey('personal').concat(header.filter((l) => PERSONAL_DETAIL_RE.test(l.text)));
  if (personal.length) notes.push('Left out personal details (such as date of birth, marital status, address or declaration). ATS-friendly resumes do not need them.');

  polish(content);

  if (detected.size === 0) {
    warnings.push('No standard section headings (Experience, Education, Skills…) were found. Review every field carefully.');
    if (!content.summary) content.summary = joinParagraph(lines.filter((l) => l !== nameLine && !header.includes(l)).slice(0, 6));
  }
  if (!content.skills.length) warnings.push('No skills were detected. Add your key skills.');
  if (detected.has('experience') && !content.experience.length) warnings.push('An experience section was found but no roles could be separated. Please add them manually.');
  if (content.experience.some((e) => !e.company || !e.jobTitle)) warnings.push('Some job titles or company names could not be separated. Please review the Experience entries.');
  if (content.experience.some((e) => e.startDate && !e.endDate && !e.current)) warnings.push('Some roles have only one date. Add the end date, or tick "currently work here".');

  return { content, warnings, detectedSections: [...detected], notes };
}

function joinParagraph(lines: DocLine[]): string {
  return lines
    .map((l) => stripBullet(stripIcons(l.text)))
    .filter(Boolean)
    .join(' ')
    .replace(/(\w)- (\w)/g, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Some layouts put the name/headline/location after other content (LinkedIn's sidebar comes first,
 * some templates start with a contact column). Move the name block back to the header so those
 * lines don't end up as skills or certifications.
 */
function relocateNameBlock(lines: DocLine[], header: DocLine[], sections: Section[], bodySize: number | undefined, opts: StructureOptions): void {
  const headerHasName = header.some((l) => looksLikeName(stripIcons(l.text)));
  if (headerHasName && !opts.linkedin) return;
  const maxSize = Math.max(0, ...lines.filter((l) => (l.page ?? 1) === 1).map((l) => l.size ?? 0));
  for (const s of sections) {
    if (s.key === 'experience' || s.key === 'education' || s.key === 'projects') continue;
    let idx = -1;
    if (bodySize && maxSize >= bodySize * 1.3) idx = s.lines.findIndex((l) => (l.size ?? 0) >= maxSize - 0.5 && looksLikeName(stripIcons(l.text)));
    if (idx < 0) {
      // Text-only fallback: a name-like line followed (within 3 lines) by a location, at the end of a sidebar section.
      idx = s.lines.findIndex((l, i) => looksLikeName(stripIcons(l.text)) && !isDictionarySkill(l.text) && s.lines.length - i <= 5 && s.lines.slice(i + 1, i + 4).some((x) => isLocation(x.text)));
    }
    if (idx < 0 && opts.linkedin && sections[sections.indexOf(s) + 1] && ['summary', 'experience'].includes(sections[sections.indexOf(s) + 1].key)) {
      // LinkedIn always ends the sidebar with name (+ headline, + location) right before Summary/Experience.
      idx = s.lines.findIndex((l, i) => s.lines.length - i <= 4 && looksLikeName(stripIcons(l.text)) && !isDictionarySkill(l.text));
    }
    if (idx < 0) continue;
    // Name + following lines up to and including the location (max 4 lines).
    let end = idx + 1;
    while (end < s.lines.length && end - idx < 5 && !isLocation(s.lines[end - 1].text)) end++;
    if (end - idx === 5 || (end === s.lines.length && !isLocation(s.lines[end - 1].text))) end = Math.min(s.lines.length, idx + 3);
    const moved = s.lines.splice(idx, end - idx);
    header.unshift(...moved);
    return;
  }
}

/** A factual starter summary assembled only from parsed fields (no AI, nothing invented). */
export function starterSummary(c: ResumeContent): string {
  const latest = c.experience.find((e) => e.jobTitle);
  const edu = c.education.find((e) => e.degree);
  const role = c.targetJobTitle || latest?.jobTitle || (edu ? `${edu.degree}${edu.field ? ` (${edu.field})` : ''} graduate` : '');
  if (!role) return '';
  const skills = c.skills.filter((s) => words(s).length <= 3).slice(0, 5);
  const sentences: string[] = [];
  sentences.push(`${role}${skills.length ? ` skilled in ${listJoin(skills)}` : ''}.`);
  const roles = c.experience.filter((e) => e.jobTitle && e.company).slice(0, 2);
  if (roles.length) sentences.push(`Experience includes ${listJoin(roles.map((e) => `${e.jobTitle} at ${e.company}`))}.`);
  const projects = c.projects.map((p) => p.name).filter((n) => n && n !== 'Project').slice(0, 2);
  if (projects.length) sentences.push(`Built projects such as ${listJoin(projects)}.`);
  if (edu && edu.institution) sentences.push(`Holds a ${edu.degree}${edu.field ? ` in ${edu.field}` : ''} from ${edu.institution}.`);
  return sentences.join(' ');
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Resume voice without "I"/"my", using only safe, meaning-preserving rewrites:
 * "I'm a Full-Stack Developer at X" -> "Full-Stack Developer at X", "I develop…" -> "Develop…",
 * "I'm passionate about…" -> "Passionate about…", "alongside my work" -> "alongside work".
 */
export function depersonalize(text: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return text
    .replace(/([a-z0-9]{2})\.([A-Z][a-z])/g, '$1. $2') // "impact.Alongside" -> "impact. Alongside"
    // Sentence ends need a real word before the period, so "M.E. in AI" or "e.g. React" are not split.
    .split(/(?<=[A-Za-z0-9)]{2}[.!?])\s+(?=[A-Z])/)
    .map((sentence) =>
      cap(
        sentence
          .replace(/^(?:I['’]m|I am)\s+(?:an?\s+)?/i, '')
          .replace(/^I\s+(?=[a-z])/, '')
          .replace(/,\s*(?:I['’]m|I am)\s+/gi, ', ')
          .replace(/\b(?:I['’]ve|I have)\s+/gi, '')
          .replace(/\bmy\s+/gi, '')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    )
    .join(' ')
    // "…an M.E. I'm passionate…" (not split above because of the abbreviation)
    .replace(/([.!?])\s+(?:I['’]m|I am|I)\s+([a-z])/g, (_, p: string, c: string) => `${p} ${c.toUpperCase()}`);
}

// ---------- Deterministic polish (no AI) ----------

function polish(c: ResumeContent) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const bullet = (s: string) => cap(depersonalize(s.replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim()));
  const dedupe = (a: string[]) => dedupeCaseInsensitive(a.map(bullet).filter(Boolean));
  for (const e of c.experience) {
    e.jobTitle = headlineCase(e.jobTitle);
    e.company = headlineCase(e.company);
    e.description = dedupe(e.description);
    if (e.current) e.endDate = '';
  }
  for (const p of c.projects) p.description = dedupe(p.description);
  for (const e of c.education) {
    e.institution = smartTitleCase(e.institution);
    e.degree = e.degree.trim();
    e.field = smartTitleCase(e.field);
  }
  c.summary = depersonalize(c.summary.replace(/\s+/g, ' ').trim());
  // Newest first; current roles on top.
  const key = (d: string) => {
    const n = normalizeDate(d);
    const m = n.match(/^(\w{3}) (\d{4})$/);
    if (m) return Number(m[2]) * 12 + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]);
    const y = n.match(/^(\d{4})$/);
    return y ? Number(y[1]) * 12 : -1;
  };
  c.experience.sort((a, b) => (b.current ? 1e9 : key(b.endDate || b.startDate)) - (a.current ? 1e9 : key(a.endDate || a.startDate)) || key(b.startDate) - key(a.startDate));
  c.education.sort((a, b) => key(b.endDate || b.startDate) - key(a.endDate || a.startDate));
}
