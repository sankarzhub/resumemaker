// Mirrors server/src/utils/dates.ts so the live preview matches the exported files.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatResumeDate(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^(present|current|now|till date|to date|ongoing)$/i.test(s)) return 'Present'
  if (/^\d{4}$/.test(s)) return s
  let m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${SHORT[+m[2] - 1]} ${m[1]}`
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/)
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${SHORT[+m[1] - 1]} ${m[2]}`
  m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (idx >= 0) return `${SHORT[idx]} ${m[2]}`
  }
  return s
}

export function formatDateRange(start: string, end: string, current: boolean): string {
  const s = formatResumeDate(start)
  const e = current ? 'Present' : formatResumeDate(end)
  if (s && e) return `${s} - ${e}`
  return s || e
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
