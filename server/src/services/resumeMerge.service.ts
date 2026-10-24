import type { ResumeContent } from '../types/resume.js';
import { monthIndex, parseResumeDate } from '../utils/dates.js';
import { canonicalSkill } from './skills.js';
import type { DocRole } from './resumeParser.service.js';

export interface SourceDoc {
  name: string; // shown to the user, e.g. "Profile.pdf (LinkedIn)"
  role: DocRole;
  content: ResumeContent;
}

export interface ConflictOption {
  source: string;
  value: string;
}

/** A fact the documents disagree on. `path` points into the merged content, e.g. "experience[1].startDate". */
export interface Conflict {
  path: string;
  label: string;
  options: ConflictOption[];
  selected: string;
}

export interface MergeResult {
  content: ResumeContent;
  conflicts: Conflict[];
  notes: string[];
}

type Exp = ResumeContent['experience'][number];
type Edu = ResumeContent['education'][number];

const COMPANY_NOISE = /\b(pvt|private|ltd|limited|inc|llc|llp|corp|corporation|co|company|technologies|technology|tech|solutions|services|software|india|group|the)\b/g;

export function normKey(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, ' ').replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

function normContact(field: string, v: string): string {
  const s = v.trim().toLowerCase();
  if (field === 'phone') return s.replace(/\D/g, '').slice(-10);
  if (['linkedin', 'github', 'portfolio'].includes(field)) return s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  return s.replace(/\s+/g, ' ');
}

/** Same value, or for names/locations one is a more detailed form of the other ("Chennai, India" ⊂ "Chennai, Tamil Nadu, India"). */
function compatibleContact(field: string, a: string, b: string): boolean {
  if (a === b) return true;
  if (field !== 'location' && field !== 'fullName') return false;
  const ta = a.split(/[^a-z]+/).filter(Boolean);
  const tb = b.split(/[^a-z]+/).filter(Boolean);
  const [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.length > 0 && small.every((t) => big.has(t));
}

function sameDate(a: string, b: string): boolean {
  const pa = parseResumeDate(a);
  const pb = parseResumeDate(b);
  if (pa && pb) {
    // "2022" vs "Jun 2022": treat year-only as compatible with any month in that year.
    if (pa.format === 'year' || pb.format === 'year') return pa.year === pb.year;
    return monthIndex(pa) === monthIndex(pb);
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Prefer the more specific date ("Jun 2022" over "2022") when two dates agree. */
function moreSpecific(a: string, b: string): string {
  return parseResumeDate(a)?.format === 'year' && parseResumeDate(b) && parseResumeDate(b)!.format !== 'year' ? b : a;
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const k = normKey(l);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const DEGREE_ALIASES: Record<string, string> = {
  bachelorofengineering: 'be',
  bacheloroftechnology: 'btech',
  bachelorofscience: 'bsc',
  bachelorofcommerce: 'bcom',
  bachelorofarts: 'ba',
  bachelorofcomputerapplications: 'bca',
  bachelorofbusinessadministration: 'bba',
  masterofengineering: 'me',
  masteroftechnology: 'mtech',
  masterofscience: 'msc',
  masterofcommerce: 'mcom',
  masterofarts: 'ma',
  masterofcomputerapplications: 'mca',
  masterofbusinessadministration: 'mba',
  doctorofphilosophy: 'phd',
};

/** "B.E.", "BE", "Bachelor of Engineering", "Bachelor's of Engineering - BE" all normalise to "be". */
function normDegree(s: string): string {
  const k = s.toLowerCase().replace(/['’]s\b/g, '').replace(/\s*-\s*[a-z.]{1,7}$/i, '').replace(/[^a-z]/g, '');
  return DEGREE_ALIASES[k] ?? k;
}

function nameTokens(n: string) {
  return new Set(n.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1));
}

// Conflicts are first attached to entries (which may later be re-sorted), then given final paths.
interface Pending {
  field: string;
  label: string;
  options: ConflictOption[];
}

function addOption(options: ConflictOption[], source: string, value: string) {
  if (!options.some((o) => o.value === value)) options.push({ source, value });
}

/**
 * Merge several parsed documents about one person into one resume.
 * Facts are never invented: every value comes from one of the sources, and disagreements become conflicts.
 */
export function mergeResumeDrafts(docs: SourceDoc[]): MergeResult {
  if (docs.length === 0) throw new Error('mergeResumeDrafts needs at least one document');
  // The resume is the primary source for contact details and wording; others fill gaps.
  const ordered = [...docs].sort((a, b) => Number(b.role === 'resume') - Number(a.role === 'resume'));
  const [primary] = ordered;
  const notes: string[] = [];
  const conflicts: Conflict[] = [];

  const merged: ResumeContent = structuredClone(primary.content);

  // ---- Contact details
  for (const field of Object.keys(merged.personalInfo) as Array<keyof ResumeContent['personalInfo']>) {
    const options: ConflictOption[] = [];
    const seen: string[] = [];
    for (const d of ordered) {
      const v = d.content.personalInfo[field]?.trim();
      if (!v) continue;
      const k = normContact(field, v);
      if (seen.some((s) => compatibleContact(field, s, k))) continue;
      seen.push(k);
      options.push({ source: d.name, value: v });
    }
    if (!options.length) continue;
    if (!merged.personalInfo[field]) {
      merged.personalInfo[field] = options[0].value;
      if (options[0].source !== primary.name) notes.push(`Filled ${field} from ${options[0].source}.`);
    }
    if (options.length > 1) {
      conflicts.push({ path: `personalInfo.${field}`, label: `Contact: ${field}`, options, selected: merged.personalInfo[field] });
    }
  }

  // Different people? Flag loudly instead of silently mixing two profiles.
  const names = ordered.map((d) => d.content.personalInfo.fullName).filter(Boolean);
  if (names.length > 1) {
    const first = nameTokens(names[0]);
    const unrelated = names.slice(1).find((n) => ![...nameTokens(n)].some((t) => first.has(t)));
    if (unrelated) notes.unshift(`Warning: "${names[0]}" and "${unrelated}" look like different people. Check that all documents belong to the same person.`);
  }

  if (!merged.targetJobTitle) merged.targetJobTitle = ordered.map((d) => d.content.targetJobTitle ?? '').find(Boolean) ?? '';
  if (!merged.summary.trim()) {
    const s = ordered.map((d) => d.content.summary).find((x) => x.trim());
    if (s) {
      merged.summary = s;
      notes.push('Used the summary from another document.');
    }
  }

  // ---- Skills: union by canonical name
  const skillKeys = new Set(merged.skills.map((s) => canonicalSkill(s).toLowerCase()));
  for (const d of ordered.slice(1)) {
    const added: string[] = [];
    for (const s of d.content.skills) {
      const c = canonicalSkill(s);
      if (skillKeys.has(c.toLowerCase())) continue;
      skillKeys.add(c.toLowerCase());
      merged.skills.push(c);
      added.push(c);
    }
    if (added.length) notes.push(`Added ${added.length} skill(s) from ${d.name}: ${added.join(', ')}.`);
  }

  // ---- Experience: match roles by company (and title when the company is missing)
  const expPending = new Map<Exp, Pending[]>();
  const expMatch = (a: Exp, b: Exp) => {
    const ca = normKey(a.company);
    const cb = normKey(b.company);
    if (ca && cb) {
      if (!(ca === cb || ca.includes(cb) || cb.includes(ca))) return false;
      const ta = normKey(a.jobTitle);
      const tb = normKey(b.jobTitle);
      if (!ta || !tb || ta === tb) return true;
      // Same company, different titles: the same role if the start dates are within ~3 months of each
      // other (documents often disagree slightly); otherwise a separate role (e.g. a promotion).
      const sa = parseResumeDate(a.startDate);
      const sb = parseResumeDate(b.startDate);
      return Boolean(sa && sb && Math.abs(monthIndex(sa) - monthIndex(sb)) <= 3);
    }
    return Boolean(normKey(a.jobTitle)) && normKey(a.jobTitle) === normKey(b.jobTitle) && Boolean(a.startDate) && sameDate(a.startDate, b.startDate);
  };
  for (const d of ordered.slice(1)) {
    for (const e of d.content.experience) {
      const target = merged.experience.find((m) => expMatch(m, e));
      if (!target) {
        merged.experience.push(structuredClone(e));
        notes.push(`Added role "${[e.jobTitle, e.company].filter(Boolean).join(' at ')}" from ${d.name}.`);
        continue;
      }
      const pend = expPending.get(target) ?? [];
      expPending.set(target, pend);
      const role = [target.jobTitle, target.company].filter(Boolean).join(' at ') || 'role';
      for (const f of ['jobTitle', 'company', 'location'] as const) {
        const a = normKey(target[f]);
        const b = normKey(e[f]);
        // "Qspiders" vs "QSpiders - Software Testing Training Institute": same company, keep the fuller name.
        if (f === 'company' && a && b && a !== b && (a.includes(b) || b.includes(a))) {
          if (e[f].length > target[f].length) target[f] = e[f];
          continue;
        }
        if (!target[f] && e[f]) target[f] = e[f];
        else if (target[f] && e[f] && a !== b && f !== 'location') {
          const p = pend.find((x) => x.field === f) ?? { field: f, label: `${role}: ${f === 'jobTitle' ? 'job title' : f}`, options: [{ source: primary.name, value: target[f] }] };
          if (!pend.includes(p)) pend.push(p);
          addOption(p.options, d.name, e[f]);
        }
      }
      for (const f of ['startDate', 'endDate'] as const) {
        if (f === 'endDate' && (target.current || e.current)) continue;
        if (!target[f] && e[f]) target[f] = e[f];
        else if (target[f] && e[f]) {
          if (sameDate(target[f], e[f])) target[f] = moreSpecific(target[f], e[f]);
          else {
            const p = pend.find((x) => x.field === f) ?? { field: f, label: `${role}: ${f === 'startDate' ? 'start date' : 'end date'}`, options: [{ source: primary.name, value: target[f] }] };
            if (!pend.includes(p)) pend.push(p);
            addOption(p.options, d.name, e[f]);
          }
        }
      }
      if (target.current !== e.current && (target.endDate || e.endDate)) {
        const p: Pending = {
          field: 'endDate',
          label: `${role}: still working here?`,
          options: [
            { source: target.current ? primary.name : d.name, value: 'Present' },
            { source: target.current ? d.name : primary.name, value: target.endDate || e.endDate },
          ],
        };
        pend.push(p);
      }
      const before = target.description.length;
      target.description = dedupeLines([...target.description, ...e.description]);
      if (target.description.length > before) notes.push(`Added ${target.description.length - before} detail(s) to "${role}" from ${d.name}.`);
    }
  }
  // Newest first; current roles on top.
  merged.experience.sort((a, b) => {
    const end = (x: Exp) => (x.current ? Infinity : monthIndex(parseResumeDate(x.endDate) ?? parseResumeDate(x.startDate) ?? { year: 0, month: 1, format: 'year' }));
    const start = (x: Exp) => monthIndex(parseResumeDate(x.startDate) ?? { year: 0, month: 1, format: 'year' });
    return end(b) - end(a) || start(b) - start(a);
  });
  merged.experience.forEach((e, i) => {
    for (const p of expPending.get(e) ?? []) {
      if (p.options.length < 2) continue;
      const selected = p.field === 'endDate' && e.current ? 'Present' : (e[p.field as keyof Exp] as string);
      conflicts.push({ path: `experience[${i}].${p.field}`, label: p.label, options: p.options, selected });
    }
  });

  // ---- Education: match by institution, then by degree
  const eduPending = new Map<Edu, Pending[]>();
  for (const d of ordered.slice(1)) {
    for (const e of d.content.education) {
      const target = merged.education.find((m) => {
        const a = normKey(m.institution);
        const b = normKey(e.institution);
        if (a && b) return a === b || a.includes(b) || b.includes(a);
        return Boolean(normDegree(m.degree)) && normDegree(m.degree) === normDegree(e.degree);
      });
      if (!target) {
        merged.education.push(structuredClone(e));
        notes.push(`Added education "${[e.degree, e.institution].filter(Boolean).join(', ')}" from ${d.name}.`);
        continue;
      }
      const pend = eduPending.get(target) ?? [];
      eduPending.set(target, pend);
      for (const f of ['degree', 'field', 'location', 'grade', 'startDate', 'endDate'] as const) {
        if (!target[f] && e[f]) {
          target[f] = e[f];
          continue;
        }
        if (!target[f] || !e[f]) continue;
        const isDate = f === 'startDate' || f === 'endDate';
        const same = isDate
          ? sameDate(target[f], e[f])
          : f === 'degree'
            ? normDegree(target[f]) === normDegree(e[f])
            : normKey(target[f]) === normKey(e[f]) || normKey(target[f]).includes(normKey(e[f])) || normKey(e[f]).includes(normKey(target[f]));
        if (same) {
          if (isDate) target[f] = moreSpecific(target[f], e[f]);
          continue;
        }
        if (f === 'degree' || isDate) {
          pend.push({ field: f, label: `${target.institution || 'Education'}: ${f === 'degree' ? 'degree' : f === 'startDate' ? 'start year' : 'end year'}`, options: [{ source: primary.name, value: target[f] }, { source: d.name, value: e[f] }] });
        }
      }
    }
  }
  merged.education.forEach((e, i) => {
    for (const p of eduPending.get(e) ?? []) conflicts.push({ path: `education[${i}].${p.field}`, label: p.label, options: p.options, selected: e[p.field as keyof Edu] as string });
  });

  // ---- Projects and certifications: union by name
  for (const d of ordered.slice(1)) {
    for (const p of d.content.projects) {
      const target = merged.projects.find((m) => normKey(m.name) && normKey(m.name) === normKey(p.name));
      if (!target) {
        merged.projects.push(structuredClone(p));
        notes.push(`Added project "${p.name}" from ${d.name}.`);
        continue;
      }
      target.description = dedupeLines([...target.description, ...p.description]);
      const techKeys = new Set(target.technologies.map((t) => canonicalSkill(t).toLowerCase()));
      for (const t of p.technologies) if (!techKeys.has(canonicalSkill(t).toLowerCase())) target.technologies.push(canonicalSkill(t));
      if (!target.url && p.url) target.url = p.url;
    }
    for (const c of d.content.certifications) {
      const target = merged.certifications.find((m) => normKey(m.name) === normKey(c.name));
      if (!target) {
        merged.certifications.push(structuredClone(c));
        notes.push(`Added certification "${c.name}" from ${d.name}.`);
      } else {
        if (!target.issuer && c.issuer) target.issuer = c.issuer;
        if (!target.date && c.date) target.date = c.date;
        if (!target.url && c.url) target.url = c.url;
      }
    }
  }

  // ---- Additional sections (Achievements, Activities, Languages…): union by title and item
  merged.additionalSections ??= [];
  for (const d of ordered.slice(1)) {
    for (const s of d.content.additionalSections ?? []) {
      const target = merged.additionalSections.find((m) => normKey(m.title) === normKey(s.title));
      if (!target) {
        merged.additionalSections.push(structuredClone(s));
        notes.push(`Added the "${s.title}" section from ${d.name}.`);
      } else target.items = dedupeLines([...target.items, ...s.items]);
    }
  }

  return { content: merged, conflicts, notes };
}

/** Keep only conflicts that point at a real field and offer at least two distinct values (AI output is untrusted). */
export function validateConflicts(r: ResumeContent, conflicts: Conflict[]): Conflict[] {
  const out: Conflict[] = [];
  for (const c of conflicts) {
    const current = getByPath(r, c.path);
    if (current === undefined) continue;
    const options = c.options
      .map((o) => ({ source: o.source.trim().slice(0, 120), value: o.value.trim().slice(0, 300) }))
      .filter((o, i, arr) => o.value && arr.findIndex((x) => x.value.toLowerCase() === o.value.toLowerCase()) === i);
    if (options.length < 2 || out.some((x) => x.path === c.path)) continue;
    out.push({ path: c.path, label: c.label.trim().slice(0, 120) || c.path, options, selected: current });
  }
  return out;
}

// ---- Path helpers shared with AI conflict validation ----

const PATH = /^(personalInfo)\.(\w+)$|^(experience|education|projects|certifications)\[(\d+)\]\.(\w+)$|^(summary|targetJobTitle)$/;

export function getByPath(r: ResumeContent, path: string): string | undefined {
  const m = path.match(PATH);
  if (!m) return undefined;
  if (m[1]) {
    const v = (r.personalInfo as unknown as Record<string, unknown>)[m[2]];
    return typeof v === 'string' ? v : undefined;
  }
  if (m[3]) {
    const entry = (r[m[3] as 'experience'] as unknown as Array<Record<string, unknown>>)[Number(m[4])];
    const v = entry?.[m[5]];
    if (m[5] === 'endDate' && entry?.current) return 'Present';
    return typeof v === 'string' ? v : undefined;
  }
  return (r as unknown as Record<string, string>)[m[6]];
}
