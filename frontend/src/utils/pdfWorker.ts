// pdf.js's worker, wrapped so the polyfill it needs is installed in the worker's scope before it
// starts decoding anything. Loaded by @/utils/pdfjs — nothing else should reach for it.
import '@/utils/readableStreamValues'

import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
