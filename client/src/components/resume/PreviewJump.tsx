import { useEffect, useRef, useState } from 'react'
import { Eye, Pencil } from 'lucide-react'

/**
 * Below the two-column breakpoint the preview sits under the whole form. This floating button jumps to
 * it, and back to where the user was editing once the preview is on screen.
 */
export function PreviewJump({ targetId }: { targetId: string }) {
  const [previewVisible, setPreviewVisible] = useState(false)
  const returnTo = useRef(0)

  useEffect(() => {
    const target = document.getElementById(targetId)
    if (!target || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setPreviewVisible(entry.isIntersecting), { rootMargin: '0px 0px -40% 0px' })
    io.observe(target)
    return () => io.disconnect()
  }, [targetId])

  function jump() {
    if (previewVisible) {
      window.scrollTo({ top: returnTo.current, behavior: 'smooth' })
    } else {
      returnTo.current = window.scrollY
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <button type="button" className="btn btn-gold fixed right-4 bottom-4 z-40 shadow-lg xl:hidden" onClick={jump}>
      {previewVisible ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {previewVisible ? 'Back to editing' : 'Preview'}
    </button>
  )
}
