import type * as PdfJs from 'pdfjs-dist'

let loading: Promise<typeof PdfJs> | null = null

/** pdf.js is large, so it is loaded on first use (keeps the main bundle small). */
export function loadPdfjs(): Promise<typeof PdfJs> {
  loading ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })
  return loading
}
