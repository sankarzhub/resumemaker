import type { ResumeContent } from '../types/resume.js';
import { canonicalSkill, extractSkills, isSoftSkill, normalizeText, relatedSkills, textMentionsSkill } from './skills.js';
import type { CategoryResult } from './atsChecker.service.js';

export type MatchStatus = 'listed-and-evidenced' | 'listed' | 'evidenced' | 'related' | 'not-evidenced';
export type Importance = 'required' | 'preferred';

export interface SkillMatch {
  skill: string;
  importance: Importance;
  status: MatchStatus;
  evidence: string[]; // where in the resume it was found, e.g. "Skills", "Experience: Engineer at Acme"
  related: string[]; // related skills the resume does show, for "related" status
}

export interface JobMatchReport {
  score: number;
  scoreType: 'estimated';
  breakdown: CategoryResult[];
  skills: SkillMatch[];
  matchedSkills: string[];
  relatedSkills: string[];
  missingSkills: string[];
  titleMatch: { jobTitle: string | null; resumeTitles: string[]; matches: boolean };
  suggestions: string[];
  disclaimer: string;
}

const PREFERRED_CUES = /(preferred|nice[- ]to[- ]have|bonus|plus\b|good to have|desirable|advantage|optional|familiarity with)/i;
const REQUIRED_CUES = /(required|requirements|must[- ]have|must\b|minimum qualifications|essential|you have|what you.?ll need|qualifications)/i;

/** Split a JD into required/preferred blocks using heading and line-level cues. */
export function classifyJobSkills(jd: string): Map<string, Importance> {
  const result = new Map<string, Importance>();
  let section: Importance = 'required';
  for (const rawLine of jd.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isHeading = line.length < 60 && /:$|^#+\s|^[A-Z][A-Za-z '&/-]+$/.test(line);
    if (isHeading && PREFERRED_CUES.test(line)) section = 'preferred';
    else if (isHeading && REQUIRED_CUES.test(line)) section = 'required';
    const lineImportance: Importance = PREFERRED_CUES.test(line) && !isHeading ? 'preferred' : section;
    for (const skill of extractSkills(line)) {
      // Required wins if a skill appears in both places.
      if (result.get(skill) !== 'required') result.set(skill, lineImportance);
    }
  }
  return result;
}

export function guessJobTitle(jd: string): string | null {
  const first = jd.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const m = jd.match(/(?:job title|position|role)\s*[:-]\s*([^\n]{3,80})/i);
  if (m) return m[1].trim();
  if (first.length <= 70 && /(engineer|developer|analyst|manager|designer|scientist|consultant|architect|specialist|intern|lead|administrator|executive|associate|officer|accountant)/i.test(first)) {
    return first.replace(/[:\-–|].*$/, '').trim();
  }
  return null;
}

function resumeEvidenceSources(r: ResumeContent): Array<{ label: string; text: string }> {
  return [
    { label: 'Summary', text: r.summary },
    ...r.experience.map((e) => ({
      label: `Experience: ${[e.jobTitle, e.company].filter(Boolean).join(' at ') || 'entry'}`,
      text: [e.jobTitle, ...e.description].join('\n'),
    })),
    ...r.projects.map((p) => ({ label: `Project: ${p.name || 'entry'}`, text: [p.name, ...p.technologies, ...p.description].join('\n') })),
    ...r.certifications.map((c) => ({ label: `Certification: ${c.name}`, text: c.name })),
  ];
}

export function matchResumeToJob(r: ResumeContent, jobDescription: string): JobMatchReport {
  const jd = normalizeText(jobDescription) ? jobDescription : '';
  const jobSkills = classifyJobSkills(jd);
  const listed = new Set(r.skills.map((s) => canonicalSkill(s)));
  const sources = resumeEvidenceSources(r);

  const evidenceFor = (skill: string) => sources.filter((s) => s.text && textMentionsSkill(s.text, skill)).map((s) => s.label);
  const resumeHas = (skill: string) => listed.has(skill) || evidenceFor(skill).length > 0;

  const skills: SkillMatch[] = [];
  for (const [skill, importance] of jobSkills) {
    const isListed = listed.has(skill);
    const evidence = evidenceFor(skill);
    let status: MatchStatus;
    if (isListed && evidence.length) status = 'listed-and-evidenced';
    else if (isListed) status = 'listed';
    else if (evidence.length) status = 'evidenced';
    else status = 'not-evidenced';
    const related = status === 'not-evidenced' ? relatedSkills(skill).filter(resumeHas) : [];
    if (status === 'not-evidenced' && related.length) status = 'related';
    skills.push({ skill, importance, status, evidence: isListed ? ['Skills', ...evidence] : evidence, related });
  }

  // Scoring: required skills weigh 2x preferred; listed+evidenced is full credit, listed-only or evidenced-only partial.
  const credit: Record<MatchStatus, number> = {
    'listed-and-evidenced': 1,
    evidenced: 0.85,
    listed: 0.7,
    related: 0.25,
    'not-evidenced': 0,
  };
  const weightOf = (s: SkillMatch) => (s.importance === 'required' ? 2 : 1) * (isSoftSkill(s.skill) ? 0.5 : 1);
  const totalWeight = skills.reduce((a, s) => a + weightOf(s), 0);
  const earnedWeight = skills.reduce((a, s) => a + weightOf(s) * credit[s.status], 0);
  const skillScore = totalWeight ? earnedWeight / totalWeight : 0;

  const jobTitle = guessJobTitle(jd);
  const resumeTitles = r.experience.map((e) => e.jobTitle).filter(Boolean);
  if (r.targetJobTitle) resumeTitles.unshift(r.targetJobTitle);
  const titleWords = (jobTitle ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !['senior', 'junior', 'and', 'the'].includes(w));
  const titleMatches = titleWords.length > 0 && resumeTitles.some((t) => titleWords.filter((w) => t.toLowerCase().includes(w)).length >= Math.ceil(titleWords.length / 2));

  const required = skills.filter((s) => s.importance === 'required');
  const reqCovered = required.filter((s) => credit[s.status] >= 0.7).length;

  const skillCat: CategoryResult = {
    key: 'skillsMatch',
    label: 'Skill coverage',
    max: 70,
    earned: Math.round(skillScore * 70),
    reasons: skills.length
      ? [`${reqCovered} of ${required.length} required skills are clearly shown.`, `${skills.filter((s) => s.importance === 'preferred' && credit[s.status] >= 0.7).length} of ${skills.length - required.length} preferred skills are clearly shown.`]
      : ['No recognised skills found in the job description. Matching uses a curated skill list, so niche tools may not be detected.'],
  };
  const evidenceCat: CategoryResult = {
    key: 'experienceRelevance',
    label: 'Evidence in experience/projects',
    max: 20,
    earned: skills.length ? Math.round((skills.filter((s) => s.status === 'listed-and-evidenced' || s.status === 'evidenced').length / skills.length) * 20) : 0,
    reasons: ['Skills used in bullet points are stronger evidence than skills only listed in the skills section.'],
  };
  const titleCat: CategoryResult = {
    key: 'titleMatch',
    label: 'Job title alignment',
    max: 10,
    earned: jobTitle ? (titleMatches ? 10 : 3) : 5,
    reasons: [jobTitle ? (titleMatches ? `Your titles align with "${jobTitle}".` : `None of your titles closely match "${jobTitle}". Set a target job title if it honestly fits.`) : 'Could not detect a job title in the description.'],
  };
  const breakdown = [skillCat, evidenceCat, titleCat];

  const suggestions: string[] = [];
  const listedOnly = skills.filter((s) => s.status === 'listed');
  if (listedOnly.length) suggestions.push(`You list ${listedOnly.map((s) => s.skill).join(', ')} but no bullet shows how you used them. Add a bullet if you have real experience.`);
  const evidencedOnly = skills.filter((s) => s.status === 'evidenced');
  if (evidencedOnly.length) suggestions.push(`Add ${evidencedOnly.map((s) => s.skill).join(', ')} to your skills section; your experience already shows them.`);
  const missingReq = skills.filter((s) => s.importance === 'required' && s.status === 'not-evidenced');
  if (missingReq.length) suggestions.push(`Required skills not found in your resume: ${missingReq.map((s) => s.skill).join(', ')}. Only add them if you genuinely have this experience.`);
  const relatedOnly = skills.filter((s) => s.status === 'related');
  for (const s of relatedOnly) suggestions.push(`"${s.skill}" not found, but you show related skills (${s.related.join(', ')}). Mention ${s.skill} only if you have used it.`);

  return {
    score: breakdown.reduce((a, c) => a + c.earned, 0),
    scoreType: 'estimated',
    breakdown,
    skills,
    matchedSkills: skills.filter((s) => credit[s.status] >= 0.7).map((s) => s.skill),
    relatedSkills: relatedOnly.map((s) => s.skill),
    missingSkills: skills.filter((s) => s.status === 'not-evidenced').map((s) => s.skill),
    titleMatch: { jobTitle, resumeTitles, matches: titleMatches },
    suggestions,
    disclaimer: 'Estimated keyword and evidence match. Employers configure their own systems; this cannot predict how a specific ATS ranks you.',
  };
}
