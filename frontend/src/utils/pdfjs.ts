// pdf.js does its parsing in a web worker, and it cannot find that worker on its own: the built-in
// default (`../build/pdf.worker.mjs`) resolves against the page URL rather than the bundle, so it
// 404s and every document fails to open — silently, since the only symptom is a rejected
// getDocument().
//
// Handing it a URL to fetch is not the way to do that here. Constructing the Worker ourselves is
// the shape Vite compiles as a worker — served as one in dev, emitted as an asset in the build —
// and it is what lets the worker be wrapped (./pdfWorker.ts) instead of loaded raw. pdf.js takes
// the live Worker through `workerPort`.
//
// One module, so the whole frontend shares one copy of pdf.js and one worker: mail's attachment
// viewer (via vue-pdf-embed's "essential" build, which imports pdf.js instead of inlining a second
// copy of it) and drive's file preview both render through this instance. The worker options are
// per module instance, so everything has to reach pdf.js by the same specifier — the legacy build,
// which is what vue-pdf-embed's essential build imports, and which is transpiled far enough back to
// run on the older iOS Safaris that a PWA install can pin a user to.
//
// The worker outlives the documents drawn through it: pdf.js re-attaches to the same port for each
// one, so there is nothing to tear down between attachments.
import '@/utils/readableStreamValues'

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfWorker.ts', import.meta.url), {
	type: 'module',
})

export { pdfjs }
