// The Content-Security-Policy a mail's own document carries: the reader's frame (EmailContent) and
// the printed page (printMail). The sanitizer and blockRemoteAssets clean the mail, but CSS has
// more ways to name a URL than any pattern keeps up with (escapes, image-set(), constructs left
// open at the end of a sheet), so while remote content is withheld it is the browser that refuses
// every load from another host. Only what a mail needs to render with nothing remote is allowed:
// its inline styles and stylesheets, data: and blob: images and fonts, and the one same-origin
// endpoint the server points inline (cid:) images at. Not the whole origin: the app has endpoints
// that fetch a URL they are given (a link preview), and an <img> naming one would have the server
// fetch the sender's URL the moment the mail opens. Shown, no load is restricted, so remote
// content loads as it did before there was a policy. Either way the document runs no script but
// the one carrying `scriptNonce`, and nothing in it can embed a plugin, set a base URL or submit a
// form.
//
// Delivered as a <meta> first in the document's <head>, not the iframe's `csp` attribute: every
// browser enforces a meta policy, the attribute only Chromium, and a meta policy governs
// everything the parser meets after it, which is the whole mail.

// Where format_message points each `cid:` image, its blob named in the query. A source with a path
// matches that path exactly, whatever the query; the endpoint answers with the image itself, no
// redirect, so the match holds for the response too.
const INLINE_PARTS = '/api/method/suite.mail.api.mail.get_attachment'

const withheld = () => [
  "default-src 'none'",
  `img-src ${window.location.origin}${INLINE_PARTS} data: blob:`,
  'font-src data: blob:',
  "style-src 'unsafe-inline'",
]

/**
 * The tags that open a mail document's <head>: its policy, withholding remote loads when
 * `withholdRemote`, and running only the script whose nonce is `nonce` (none without one).
 */
export const mailDocumentPolicy = (withholdRemote: boolean, nonce?: string): string => {
  const policy = [
    ...(withholdRemote ? withheld() : []),
    `script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  // A host name is a request too: a resolver the sender runs sees it looked up, and a browser
  // may resolve the hosts a document links to before anything is clicked.
  const prefetch = withholdRemote ? '<meta http-equiv="x-dns-prefetch-control" content="off">' : ''
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${prefetch}`
}

/** A fresh nonce for the one script a mail document runs. */
export const scriptNonce = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
