import { titleExtension } from './filename'

/** The languages the text preview highlights. `plain` is text with no highlighting. */
export type TextLanguage =
  | 'html'
  | 'markdown'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'css'
  | 'scss'
  | 'python'
  | 'sql'
  | 'xml'
  | 'yaml'
  | 'plain'

/** How the preview shows a file. */
export type PreviewKind =
  | { kind: 'image' }
  | { kind: 'audio' }
  | { kind: 'video' }
  | { kind: 'pdf' }
  /** The file's bytes, fetched and shown as source text. Markdown can also show rendered and cleaned. HTML never renders. */
  | { kind: 'text'; language: TextLanguage }
  | { kind: 'none' }

export interface PreviewedFile {
  title: string
  mime: string | null
  /** True when Drive keeps a preview image for the file. */
  hasPreview: boolean
}

// Drive records the MIME type it sniffs from the bytes, and most text formats
// have no signature, so they arrive as `application/octet-stream`. The name's
// extension is what tells a Markdown file from any other bytes.
const EXTENSIONS = new Map<string, TextLanguage>([
  ['html', 'html'],
  ['htm', 'html'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'javascript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['json', 'json'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['py', 'python'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['txt', 'plain'],
  ['csv', 'plain'],
  ['tsv', 'plain'],
  ['log', 'plain'],
])

const MIMES = new Map<string, TextLanguage>([
  ['text/html', 'html'],
  ['text/markdown', 'markdown'],
  ['text/javascript', 'javascript'],
  ['application/javascript', 'javascript'],
  ['application/json', 'json'],
  ['text/css', 'css'],
  ['text/x-python', 'python'],
  ['application/xml', 'xml'],
  ['text/xml', 'xml'],
  ['application/yaml', 'yaml'],
  ['application/x-yaml', 'yaml'],
  ['text/yaml', 'yaml'],
])

/**
 * Media and PDF types win, because the browser draws them. A file whose name
 * or type says text is shown as text, HTML included: an uploaded page is never
 * rendered on the app's origin. Any other file shows its preview image, if
 * Drive made one, or nothing.
 */
export function previewKind({ title, mime, hasPreview }: PreviewedFile): PreviewKind {
  const type = (mime ?? '').toLowerCase()
  if (type.startsWith('image/')) return { kind: 'image' }
  if (type.startsWith('audio/')) return { kind: 'audio' }
  if (type.startsWith('video/')) return { kind: 'video' }
  if (type === 'application/pdf') return { kind: 'pdf' }
  const language = textLanguage(title, type)
  if (language) return { kind: 'text', language }
  return hasPreview ? { kind: 'image' } : { kind: 'none' }
}

function textLanguage(title: string, type: string): TextLanguage | null {
  const extension = titleExtension(title)?.toLowerCase() ?? ''
  return EXTENSIONS.get(extension) ?? MIMES.get(type) ?? (type.startsWith('text/') ? 'plain' : null)
}
