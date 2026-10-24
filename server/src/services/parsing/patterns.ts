// Shared vocabulary for the rule-based resume reader.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const YEAR = '(?:19[5-9]\\d|20[0-4]\\d)';
// "Mar 2023", "March, 2023", "Mar'23", "03/2023", "3-2023", "2023/03", "2023-03", "2023"
// Two-digit years need an apostrophe ("Mar'23") so prose like "may 10 users" is never read as a date.
const DATE_TOKEN = `(?:${MONTH}\\s*,?\\s*${YEAR}|${MONTH}\\s*'\\d{2}(?!\\d)|(?:0?[1-9]|1[0-2])\\s*[/.-]\\s*${YEAR}|${YEAR}\\s*[/.-]\\s*(?:0?[1-9]|1[0-2])(?!\\d)|${YEAR})`;
const PRESENT = '(?:present|current(?:ly)?|now|today|till\\s+date|to\\s+date|ongoing|till\\s+now)';
const RANGE_SEP = '\\s*(?:-|–|—|~|to|till|until|through)\\s*';

export const DATE_RANGE_RE = new RegExp(`(?<![\\w/])(${DATE_TOKEN})${RANGE_SEP}(${DATE_TOKEN}|${PRESENT})(?![\\w/])`, 'i');
export const SINGLE_DATE_RE = new RegExp(`(?<![\\w/.])(${DATE_TOKEN})(?![\\w/])`, 'i');
const SINCE_RE = new RegExp(`\\b(?:since|from)\\s+(${DATE_TOKEN})(?![\\w/])`, 'i');

/** Normalise any supported date token to "Mon YYYY", "YYYY" or "Present". Unknown input is returned trimmed. */
export function normalizeDate(raw: string): string {
  const s = raw.trim().replace(/\.$/, '');
  if (new RegExp(`^${PRESENT}$`, 'i').test(s)) return 'Present';
  let m = s.match(new RegExp(`^(${MONTH})\\s*[,']?\\s*('?)(\\d{4}|(?<=')\\d{2})$`, 'i'));
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (idx >= 0) return `${SHORT_MONTHS[idx]} ${year}`;
  }
  m = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${SHORT_MONTHS[+m[1] - 1]} ${m[2]}`;
  m = s.match(/^(\d{4})\s*[/.-]\s*(\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${SHORT_MONTHS[+m[2] - 1]} ${m[1]}`;
  return s;
}

export interface FoundDates {
  start: string;
  end: string;
  current: boolean;
  /** The line with the date text removed. */
  rest: string;
}

export function findDates(line: string): FoundDates | null {
  const strip = (s: string) =>
    s
      .replace(/[([{]\s*[)\]}]/g, ' ')
      .replace(/^[\s|,:;–—·•-]+|[\s|,:;–—·•(-]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  const r = line.match(DATE_RANGE_RE);
  if (r) {
    const end = normalizeDate(r[2]);
    return { start: normalizeDate(r[1]), end: end === 'Present' ? '' : end, current: end === 'Present', rest: strip(line.replace(r[0], ' ')) };
  }
  const since = line.match(SINCE_RE);
  if (since) return { start: normalizeDate(since[1]), end: '', current: true, rest: strip(line.replace(since[0], ' ')) };
  const s = line.match(SINGLE_DATE_RE);
  if (s) return { start: normalizeDate(s[1]), end: '', current: false, rest: strip(line.replace(s[0], ' ')) };
  return null;
}

// ---------- Text helpers ----------

export const BULLET_RE = /^\s*(?:[•●○◦▪▫■□◆◇❖➢➤►▶▸▹✓✔✗☑➔→⇒⦿※*–—-]|\d{1,2}[.)](?!\d))\s*/u;
// Decorative glyphs/icons (contact icons, emoji, icon-font private-use characters).
const ICONS = /[\p{Extended_Pictographic}-️‍☀-⛿✀-✒✔✖-➿]/gu;

/** Remove icons anywhere in the line. Icons used as separators become " | " so fields stay apart. */
export function stripIcons(s: string): string {
  return s
    .replace(/^[\s\p{Extended_Pictographic}-️‍☀-➿]+/u, '')
    .replace(/(\S)\s*[\p{Extended_Pictographic}☀-⛿-]️?\s*(?=\S)/gu, '$1 | ')
    .replace(ICONS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBulletLine(s: string): boolean {
  return BULLET_RE.test(s) && !/^\s*\d{4}/.test(s) && !/^\s*-?\d+(\.\d+)?\s*(%|\/)/.test(s);
}

export function stripBullet(s: string): string {
  return s.replace(BULLET_RE, '').trim();
}

export function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

export function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** "ONLINE VOTING SYSTEM" -> "Online Voting System", keeping short acronyms and initials ("API", "A S"). */
export function smartTitleCase(s: string): string {
  if (!isAllCaps(s)) return s.trim();
  return s
    .trim()
    .split(/(\s+|-|\/)/)
    .map((w) => {
      const letters = w.replace(/[^\p{L}]/gu, '');
      if (letters.length <= 1) return w;
      if (letters.length <= 3 && /^[A-Z]+$/.test(letters) && !COMMON_SHORT_WORDS.has(letters.toLowerCase())) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join('');
}
/** Person names: "SAM DEMO" -> "Sam Demo", "SUMATHI A S" -> "Sumathi A S", "priya raman" -> "Priya Raman". */
export function nameCase(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.replace(/\p{L}[\p{L}'’]*/gu, (w) => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'via']);

/** Job titles/companies: capitalise all-lowercase words ("Embedded intern" -> "Embedded Intern"), keep "iOS", "i2", "QA". */
export function headlineCase(s: string): string {
  const t = smartTitleCase(s);
  return t.replace(/(^|\s)([a-z]{3,})(?=\s|$|[,.)])/g, (m, sp: string, w: string) => (SMALL_WORDS.has(w) && sp ? m : `${sp}${w[0].toUpperCase()}${w.slice(1)}`));
}

const COMMON_SHORT_WORDS =new Set(['and', 'the', 'for', 'of', 'in', 'on', 'to', 'at', 'by', 'app', 'web', 'top', 'key', 'new', 'one', 'two', 'our', 'end', 'set', 'use']);

// ---------- Vocabulary ----------

export const TITLE_WORDS =
  /\b(engineer|developer|intern(ship)?|analyst|manager|lead|designer|consultant|architect|specialist|associate|executive|administrator|admin|officer|assistant|scientist|coordinator|head|director|trainee|tester|programmer|representative|accountant|teacher|lecturer|professor|technician|founder|co-?founder|ceo|cto|cfo|vp|president|supervisor|operator|clerk|nurse|doctor|pharmacist|advisor|adviser|strategist|editor|writer|researcher|fellow|apprentice|volunteer|instructor|tutor|mentor|owner|partner|agent|recruiter|auditor|sde|qa|devops|sre|freelancer?|staff|principal|member|secretary|chair|captain)\b/i;

export const COMPANY_WORDS =
  /\b(pvt|private|ltd|limited|inc|llc|llp|corp|corporation|co\.|company|technologies|technology|tech|solutions|systems|services|software|labs?|consulting|consultancy|infotech|infosys|tcs|wipro|hcl|cognizant|accenture|bank|hospital|group|industries|enterprises?|global|international|ventures|studios?|media|foundation|ngo|agency|institute|academy|university|college|school|organization|organisation|startup|motors|pharma|retail|logistics)\b/i;

// Two-letter degrees (B.E, M.A, M.S, MD…) must be written in capitals without inner spaces, so prose
// like "I'm a developer" or "be a part" never reads as a degree.
const SHORT_DEGREE_RE = /(?<![\w.])(?:B\.?E|M\.?E|B\.?A|M\.?A|B\.?S|M\.?S|MD|B\.?Ed|M\.?Ed)(?![\w])\.?/;
const LONG_DEGREE_RE =
  /\b(b\.?\s?tech|b\.?\s?sc|b\.?\s?com|b\.?\s?b\.?\s?a|b\.?\s?c\.?\s?a|b\.?\s?arch|b\.?\s?pharm|b\.?\s?des|b\.?\s?voc|b\.?\s?f\.?\s?a|bds|llb|llm|m\.?\s?tech|m\.?\s?sc|m\.?\s?com|m\.?\s?c\.?\s?a|m\.?\s?b\.?\s?a|m\.?\s?des|m\.?\s?phil|m\.?\s?f\.?\s?a|mbbs|ph\.?\s?d|bachelor'?s?|master'?s?|diploma|associate degree|doctorate|hsc|sslc|ssc|cbse|icse|higher secondary|secondary|senior secondary|12th|10th|xii|class\s+(x|xii|10|12)|high school|intermediate|matriculation|puc|pre-university|post graduate|undergraduate|pgdm|pgdca)\b/i;

/** Degree mention test: long forms case-insensitive, short codes case-sensitive. Only `.test` is supported. */
export const DEGREE_RE = {
  test: (s: string) => LONG_DEGREE_RE.test(s) || SHORT_DEGREE_RE.test(s),
};

export const INSTITUTION_RE = /\b(university|college|institute|institution|school|academy|iit|nit|iiit|bits|polytechnic|vidyalaya|vidyalayam|matriculation|campus|faculty)\b/i;

export const NATURAL_LANGUAGES = new Set(
  'english tamil hindi telugu kannada malayalam marathi bengali bangla gujarati punjabi urdu odia oriya assamese sanskrit french german spanish japanese chinese mandarin cantonese arabic russian italian portuguese korean dutch turkish persian sinhala nepali'.split(' '),
);

// Common places so a bare "Coimbatore" or "Remote" can be recognised as a location.
const PLACES = new Set(
  `india usa us uk uae canada australia germany singapore malaysia dubai qatar oman kuwait bahrain saudi arabia sri lanka nepal bangladesh france netherlands ireland japan china new zealand south africa
  chennai coimbatore madurai trichy tiruchirappalli salem erode tirunelveli vellore tiruppur thanjavur karur namakkal hosur kanchipuram pondicherry puducherry bengaluru bangalore mysuru mysore mangaluru mangalore hubli
  hyderabad secunderabad vijayawada visakhapatnam vizag warangal tirupati guntur kochi cochin trivandrum thiruvananthapuram kozhikode calicut thrissur mumbai pune nagpur nashik thane navi aurangabad
  delhi new delhi noida gurgaon gurugram faridabad ghaziabad kolkata howrah ahmedabad surat vadodara rajkot jaipur jodhpur udaipur lucknow kanpur varanasi agra allahabad prayagraj patna ranchi bhubaneswar
  cuttack raipur bhopal indore gwalior jabalpur chandigarh mohali ludhiana amritsar dehradun shimla srinagar jammu guwahati shillong goa panaji
  tamil nadu karnataka kerala andhra pradesh telangana maharashtra gujarat rajasthan uttar madhya bihar west bengal odisha punjab haryana assam jharkhand chhattisgarh uttarakhand himachal
  london new york san francisco seattle austin boston chicago toronto vancouver sydney melbourne berlin munich amsterdam paris tokyo remote hybrid onsite on-site
  dallas houston denver atlanta miami los angeles san jose san diego portland philadelphia washington dc
  tx ca ny wa ma il ga nc va co az fl nj pa oh mi mn or ut md
  texas california washington massachusetts illinois georgia virginia colorado arizona florida jersey pennsylvania ohio michigan minnesota oregon utah maryland`
    .split(/\s+/)
    .filter(Boolean),
);

/** "Chennai", "Chennai, India", "Chennai, Tamil Nadu, India", "Remote", "Bengaluru - 560001". */
export function isLocation(s: string): boolean {
  const t = s.replace(/[-–]\s*\d{5,6}$/, '').replace(/\b\d{5,6}\b/g, '').trim().replace(/[.,]$/, '');
  if (!t || t.length > 60 || /\d/.test(t) || /@/.test(t)) return false;
  if (TITLE_WORDS.test(t) || DEGREE_RE.test(t) || INSTITUTION_RE.test(t) || COMPANY_WORDS.test(t)) return false;
  const parts = t.split(/\s*,\s*/).filter(Boolean);
  if (parts.length > 4 || parts.some((p) => words(p).length > 3)) return false;
  // Every part must look like a place name; at least one must be a known place unless there are 2+ parts.
  if (!parts.every((p) => /^[\p{Lu}][\p{L}.' -]*$/u.test(p) || PLACES.has(p.toLowerCase()))) return false;
  // Two-letter state codes only count as a whole part ("Austin, TX"), never as a word inside a phrase.
  const known = parts.some((p) => PLACES.has(p.toLowerCase()) || words(p).some((w) => w.length >= 3 && PLACES.has(w.toLowerCase())));
  return known || parts.length >= 2;
}

export const ACTION_START =
  /^(achieved|analy[sz]ed|architected|assisted|automated|built|collaborated|configured|conducted|contributed|coordinated|created|debugged|delivered|deployed|designed|developed|drove|enhanced|ensured|established|executed|facilitated|generated|handled|helped|identified|implemented|improved|increased|integrated|introduced|launched|learned|learnt|led|maintained|managed|mentored|migrated|monitored|optimi[sz]ed|organi[sz]ed|participated|performed|planned|prepared|presented|produced|reduced|refactored|resolved|reviewed|streamlined|supported|tested|trained|troubleshot|upgraded|used|utili[sz]ed|wrote|worked|working|responsible|involved|gained|engaged|demonstrat\w*|enhanc\w*|creat\w*|develop\w*|build\w*|design\w*|manag\w*|lead\w*)\b/i;
