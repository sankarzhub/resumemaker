import type { ResumeContent } from '../types/resume.js';
import { monthIndex, parseResumeDate, type DateFormat } from '../utils/dates.js';
import { canonicalSkill } from './skills.js';

export interface CategoryResult {
  key: string;
  label: string;
  earned: number;
  max: number;
  reasons: string[];
}

export interface QualityReport {
  score: number;
  scoreType: 'estimated';
  breakdown: CategoryResult[];
  warnings: string[];
  suggestions: string[];
  disclaimer: string;
}

// Weights are product choices, not an industry standard. Keep them in one place so they are easy to tune.
export const WEIGHTS = {
  contact: 15,
  sections: 15,
  content: 30,
  consistency: 15,
  skills: 10,
  parsing: 15,
} as const;

const DISCLAIMER =
  'This is an estimated quality score based on transparent rules. It is not a real employer ATS score and cannot predict hiring decisions.';

export const ACTION_VERBS = new Set(
  `achieved accelerated administered analyzed architected automated boosted built championed collaborated
  configured consolidated coordinated created cut debugged decreased delivered deployed designed developed
  directed drove eliminated enabled engineered enhanced established executed expanded facilitated generated
  grew guided handled implemented improved increased initiated integrated introduced launched led maintained
  managed mentored migrated modernized monitored negotiated optimized orchestrated organized overhauled owned
  partnered performed pioneered planned prepared presented prioritized processed produced programmed proposed
  published reduced refactored resolved restructured revamped scaled secured served shipped simplified
  spearheaded standardized streamlined strengthened supervised supported taught tested trained transformed
  troubleshot upgraded wrote conducted assisted contributed handled researched documented evaluated
  identified investigated validated authored coached composed constructed converted defined earned
  established forecasted founded headed hired influenced instituted leveraged lowered modeled operated
  outperformed recruited redesigned rebuilt saved sold sourced surpassed won`.split(/\s+/),
);

const FIRST_PERSON = /\b(I|me|my|mine|myself)\b/;
const QUANTIFIED = /(\d+(\.\d+)?\s*(%|percent|x\b|k\b|m\b|\+)|[$₹€£]\s?\d|\b\d{2,}\b|\b\d+\s+(users|customers|clients|people|engineers|members|projects|hours|days|weeks|months|requests|transactions|applications|services|teams|countries|stores|schools|students))/i;
const NON_ATS_CHARS = /[☀-➿\u{1F300}-\u{1FAFF}■-◿⬀-⯿]/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+()\-.\s\d]{7,20}$/;

function words(s: string) {
  return s.trim().split(/\s+/).filter(Boolean);
}

function cat(key: keyof typeof WEIGHTS, label: string): CategoryResult {
  return { key, label, earned: WEIGHTS[key], max: WEIGHTS[key], reasons: [] };
}

function deduct(c: CategoryResult, points: number, reason: string) {
  c.earned = Math.max(0, c.earned - points);
  c.reasons.push(reason);
}

function allBullets(r: ResumeContent): string[] {
  return [...r.experience.flatMap((e) => e.description), ...r.projects.flatMap((p) => p.description)]
    .map((b) => b.trim())
    .filter(Boolean);
}

export function checkResumeQuality(r: ResumeContent): QualityReport {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const p = r.personalInfo;

  // 1. Contact completeness
  const contact = cat('contact', 'Contact information');
  if (!p.fullName.trim()) deduct(contact, 5, 'Full name is missing.');
  if (!p.email.trim()) deduct(contact, 5, 'Email address is missing.');
  else if (!EMAIL.test(p.email.trim())) deduct(contact, 3, 'Email address looks invalid.');
  if (!p.phone.trim()) deduct(contact, 3, 'Phone number is missing.');
  else if (!PHONE.test(p.phone.trim())) deduct(contact, 2, 'Phone number contains unexpected characters.');
  if (!p.location.trim()) deduct(contact, 2, 'Location (city, country) is missing; many recruiters filter by location.');
  if (!p.linkedin.trim() && !p.github.trim() && !p.portfolio.trim()) {
    suggestions.push('Add a LinkedIn, GitHub or portfolio link if you have one.');
  }

  // 2. Standard sections
  const sections = cat('sections', 'Standard sections');
  const hasWork = r.experience.some((e) => e.jobTitle.trim() || e.company.trim());
  const hasProjects = r.projects.some((x) => x.name.trim());
  if (!r.summary.trim()) deduct(sections, 3, 'Professional summary is missing.');
  if (r.skills.filter((s) => s.trim()).length === 0) deduct(sections, 4, 'Skills section is empty.');
  if (!hasWork && !hasProjects) deduct(sections, 5, 'Add work experience or projects so recruiters can see evidence of your skills.');
  else if (!hasWork) suggestions.push('No work experience listed. That is fine for students and freshers; projects carry the weight.');
  if (!r.education.some((e) => e.institution.trim() || e.degree.trim())) deduct(sections, 3, 'Education section is empty.');
  r.experience.forEach((e, i) => {
    const label = e.jobTitle || e.company || `Experience #${i + 1}`;
    if (!e.jobTitle.trim() || !e.company.trim()) warnings.push(`${label}: job title and company should both be filled in.`);
    if (e.description.filter((d) => d.trim()).length === 0) warnings.push(`${label}: add 2-5 bullet points describing your impact.`);
  });

  // 3. Content quality / readability
  const content = cat('content', 'Content quality');
  const bullets = allBullets(r);
  const summaryWords = words(r.summary).length;
  if (r.summary.trim() && (summaryWords < 25 || summaryWords > 90)) {
    deduct(content, 3, `Summary is ${summaryWords} words; aim for roughly 30-80 words.`);
  }
  if (bullets.length === 0) {
    deduct(content, 15, 'No bullet points found in experience or projects.');
  } else {
    const weakStart = bullets.filter((b) => !ACTION_VERBS.has(words(b)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''));
    const ratioWeak = weakStart.length / bullets.length;
    if (ratioWeak > 0.3) {
      deduct(content, Math.min(8, Math.round(ratioWeak * 10)), `${weakStart.length} of ${bullets.length} bullets do not start with a strong action verb (e.g. "Built", "Led", "Reduced").`);
    }
    const quantified = bullets.filter((b) => QUANTIFIED.test(b)).length;
    if (quantified / bullets.length < 0.3) {
      deduct(content, 6, `Only ${quantified} of ${bullets.length} bullets include a measurable result.`);
      suggestions.push('Add numbers where they are true and you can support them: %, time saved, users, revenue, team size.');
    }
    const tooLong = bullets.filter((b) => words(b).length > 35).length;
    if (tooLong) deduct(content, Math.min(5, tooLong * 2), `${tooLong} bullet(s) are longer than 35 words; split or tighten them.`);
    const tooShort = bullets.filter((b) => words(b).length < 5).length;
    if (tooShort) deduct(content, Math.min(4, tooShort), `${tooShort} bullet(s) are under 5 words and lack detail.`);
  }
  const fp = [r.summary, ...bullets].filter((t) => FIRST_PERSON.test(t)).length;
  if (fp) deduct(content, Math.min(4, fp), 'Avoid first-person pronouns (I, my, me) in resume text.');
  if (bullets.length === 0 && !r.summary.trim()) content.earned = 0;

  // 4. Date consistency
  const consistency = cat('consistency', 'Date consistency');
  const formats = new Set<DateFormat>();
  const checkRange = (label: string, start: string, end: string, current: boolean, requireStart: boolean) => {
    const s = parseResumeDate(start);
    const e = current ? parseResumeDate('present') : parseResumeDate(end);
    if (start.trim() && !s) deduct(consistency, 3, `${label}: start date "${start}" is not a recognised format (use "Mar 2023" or "2023-03").`);
    if (!current && end.trim() && !e) deduct(consistency, 3, `${label}: end date "${end}" is not a recognised format.`);
    if (requireStart && !start.trim()) deduct(consistency, 2, `${label}: start date is missing.`);
    if (requireStart && !current && !end.trim() && start.trim()) deduct(consistency, 1, `${label}: end date missing; tick "current" if you still work here.`);
    if (s && s.format !== 'present') formats.add(s.format);
    if (e && e.format !== 'present') formats.add(e.format);
    if (s && e && monthIndex(e) < monthIndex(s)) deduct(consistency, 4, `${label}: end date is before start date.`);
    const now = new Date();
    if (s && monthIndex(s) > now.getFullYear() * 12 + now.getMonth()) deduct(consistency, 2, `${label}: start date is in the future.`);
  };
  r.experience.forEach((x, i) => checkRange(x.jobTitle || x.company || `Experience #${i + 1}`, x.startDate, x.endDate, x.current, true));
  r.education.forEach((x, i) => checkRange(x.degree || x.institution || `Education #${i + 1}`, x.startDate, x.endDate, false, false));
  const nonYear = [...formats].filter((f) => f !== 'year');
  if (nonYear.length > 1) deduct(consistency, 3, 'Dates use mixed formats; pick one (for example "Mar 2023") and use it everywhere.');
  if (r.experience.length === 0 && r.education.length === 0) {
    consistency.earned = 0;
    consistency.reasons.push('No dated experience or education entries to check yet.');
  }

  // 5. Skills
  const skills = cat('skills', 'Skills');
  const cleaned = r.skills.map((s) => s.trim()).filter(Boolean);
  const canon = cleaned.map((s) => canonicalSkill(s).toLowerCase());
  const dupes = canon.length - new Set(canon).size;
  if (cleaned.length > 0 && cleaned.length < 5) deduct(skills, 4, `Only ${cleaned.length} skills listed; most resumes list 8-20 relevant skills.`);
  if (cleaned.length > 40) deduct(skills, 3, `${cleaned.length} skills listed; trim to the most relevant 15-30.`);
  if (dupes) deduct(skills, 2, `${dupes} duplicate skill(s) (e.g. "React" and "ReactJS").`);
  const longSkills = cleaned.filter((s) => words(s).length > 4);
  if (longSkills.length) deduct(skills, 2, 'Some skills read like sentences. Keep each skill to a short keyword.');
  if (cleaned.length === 0) skills.earned = 0;

  // 6. Parsing safety: things we can actually detect in the content
  const parsing = cat('parsing', 'ATS parsing safety');
  const allText = [r.summary, ...bullets, ...cleaned, p.fullName, ...r.experience.flatMap((e) => [e.jobTitle, e.company])].join('\n');
  if (NON_ATS_CHARS.test(allText)) deduct(parsing, 5, 'Emojis or decorative symbols found; some ATS parsers drop or garble them.');
  if (/[\t|]{2,}|\s{4,}\S+\s{4,}/.test(allText)) deduct(parsing, 3, 'Text looks column- or table-aligned; ATS parsers read single-column text more reliably.');
  if (/https?:\/\/\S{80,}/.test(allText)) deduct(parsing, 2, 'Very long URLs found; use short profile links.');
  if (p.fullName && /[^\p{L}\s.'-]/u.test(p.fullName)) deduct(parsing, 2, 'Name contains unusual characters.');
  const allCapsBullets = bullets.filter((b) => b.length > 20 && b === b.toUpperCase()).length;
  if (allCapsBullets) deduct(parsing, 2, 'Avoid writing bullets in ALL CAPS.');
  if (allText.replace(/\s/g, '').length < 50) {
    parsing.earned = 0;
    parsing.reasons.push('Not enough content yet to assess parsing safety.');
  }
  if (parsing.reasons.length === 0) parsing.reasons.push('No parsing risks detected. Exports use a single-column layout with standard headings.');

  const breakdown = [contact, sections, content, consistency, skills, parsing];
  const score = Math.round(breakdown.reduce((a, c) => a + c.earned, 0));
  for (const c of breakdown) if (c.earned === c.max && c.reasons.length === 0) c.reasons.push('Looks good.');

  return { score, scoreType: 'estimated', breakdown, warnings, suggestions, disclaimer: DISCLAIMER };
}
