const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export type DateFormat = 'year' | 'iso-month' | 'numeric-month' | 'month-name' | 'present';

export interface ParsedDate {
  year: number;
  month: number; // 1-12; 1 when only a year is given
  format: DateFormat;
}

const PRESENT = /^(present|current|now|till date|to date|ongoing)$/i;

export function parseResumeDate(raw: string): ParsedDate | null {
  const s = raw.trim();
  if (!s) return null;
  const now = new Date();
  if (PRESENT.test(s)) return { year: now.getFullYear(), month: now.getMonth() + 1, format: 'present' };

  let m = s.match(/^(\d{4})$/);
  if (m) return { year: +m[1], month: 1, format: 'year' };

  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2], format: 'iso-month' };

  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { year: +m[2], month: +m[1], format: 'numeric-month' };

  m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return { year: +m[2], month: idx + 1, format: 'month-name' };
  }
  return null;
}

export function monthIndex(d: ParsedDate): number {
  return d.year * 12 + (d.month - 1);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human, ATS-safe display: "Mar 2023", "2021", or "Present". Unparseable input is shown as typed. */
export function formatResumeDate(raw: string): string {
  const d = parseResumeDate(raw);
  if (!d) return raw.trim();
  if (d.format === 'present') return 'Present';
  if (d.format === 'year') return String(d.year);
  return `${SHORT_MONTHS[d.month - 1]} ${d.year}`;
}

export function formatDateRange(start: string, end: string, current: boolean): string {
  const s = formatResumeDate(start);
  const e = current ? 'Present' : formatResumeDate(end);
  if (s && e) return `${s} - ${e}`;
  return s || e;
}
