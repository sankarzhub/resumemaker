import type { LayoutBox, ResumeContent, ResumeLayout } from '../types/resume'

// Swapping blocks on the PDF preview. Block ids come from server/src/services/export.service.ts:
// sections "sec-<key>", entries "exp-0" / "proj-1" / "edu-0" / "cert-2", bullets "exp-0-b3" / "proj-1-b0" / "extra-2-b1".

/** Default section order; must match sectionOrder() in the export service. */
export function sectionKeys(r: ResumeContent, layout: ResumeLayout): string[] {
  const all = ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', ...r.additionalSections.map((_, i) => `extra-${i}`)]
  const saved = (layout.sectionOrder ?? []).filter((k, i, list) => all.includes(k) && list.indexOf(k) === i)
  return [...saved, ...all.filter((k) => !saved.includes(k))]
}

/** What a block is, so only like can swap with like (a bullet with a bullet of the same entry, etc.). */
function kindOf(id: string): string | null {
  if (id.startsWith('sec-')) return 'section'
  if (/^(exp|proj|edu|cert)-\d+$/.test(id)) return id.split('-')[0]
  if (/^(exp|proj|extra)-\d+-b\d+$/.test(id)) return 'bullet'
  return null
}

/** Two blocks can swap when they are the same kind of thing in the same place. */
export function canSwap(a: LayoutBox, b: LayoutBox): boolean {
  if (a.id === b.id) return false
  const k = kindOf(a.id)
  return k !== null && k === kindOf(b.id) && a.parent === b.parent
}

const swapAt = <T,>(list: T[], i: number, j: number): T[] => {
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Swap two saved-offset ids and everything inside them ("exp-1" also carries "exp-1-b0"…); the pair itself lands in place. */
function swapOffsets(offsets: ResumeLayout['offsets'], a: string, b: string): ResumeLayout['offsets'] {
  const rename = (k: string) => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (k === from) return to
      if (k.startsWith(`${from}-`)) return to + k.slice(from.length)
    }
    return k
  }
  const out: ResumeLayout['offsets'] = {}
  for (const [k, v] of Object.entries(offsets)) {
    const n = rename(k)
    if (n !== a && n !== b) out[n] = v
  }
  return out
}

/** Swap block `a` with block `b` in the resume itself, so the export prints them the other way round. */
export function swapBlocks(content: ResumeContent, layout: ResumeLayout, a: string, b: string): { content: ResumeContent; layout: ResumeLayout } | null {
  if (a.startsWith('sec-') && b.startsWith('sec-')) {
    const order = sectionKeys(content, layout)
    const i = order.indexOf(a.slice(4))
    const j = order.indexOf(b.slice(4))
    if (i < 0 || j < 0) return null
    const offsets = { ...layout.offsets }
    delete offsets[a]
    delete offsets[b]
    return { content, layout: { ...layout, offsets, sectionOrder: swapAt(order, i, j) } }
  }

  const entry = (id: string) => id.match(/^(exp|proj|edu|cert)-(\d+)$/)
  const bullet = (id: string) => id.match(/^(exp|proj|extra)-(\d+)-b(\d+)$/)
  let next: ResumeContent | null = null
  const ea = entry(a)
  const eb = entry(b)
  const ba = bullet(a)
  const bb = bullet(b)
  if (ea && eb && ea[1] === eb[1]) {
    const i = Number(ea[2])
    const j = Number(eb[2])
    const field = ({ exp: 'experience', proj: 'projects', edu: 'education', cert: 'certifications' } as const)[ea[1] as 'exp' | 'proj' | 'edu' | 'cert']
    const list = content[field] as unknown[]
    if (i >= list.length || j >= list.length) return null
    next = { ...content, [field]: swapAt(list, i, j) }
  } else if (ba && bb && ba[1] === bb[1] && ba[2] === bb[2]) {
    const n = Number(ba[2])
    const i = Number(ba[3])
    const j = Number(bb[3])
    if (ba[1] === 'extra') {
      const s = content.additionalSections[n]
      if (!s || i >= s.items.length || j >= s.items.length) return null
      next = { ...content, additionalSections: content.additionalSections.map((x, k) => (k === n ? { ...x, items: swapAt(x.items, i, j) } : x)) }
    } else {
      const field = ba[1] === 'exp' ? 'experience' : 'projects'
      const e = content[field][n]
      if (!e || i >= e.description.length || j >= e.description.length) return null
      next = { ...content, [field]: content[field].map((x, k) => (k === n ? { ...x, description: swapAt(x.description, i, j) } : x)) }
    }
  }
  if (!next) return null
  return { content: next, layout: { ...layout, offsets: swapOffsets(layout.offsets, a, b) } }
}
