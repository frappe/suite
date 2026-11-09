// pdf.js's worker, wrapped so the polyfill it needs is installed in the worker's scope before it
// starts decoding anything. Loaded by @/platform/pdf — nothing else should reach for it.
import './streamValues'
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
