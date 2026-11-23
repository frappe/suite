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

type ViewerKind = Exclude<PreviewKind['kind'], 'text' | 'none'>

// The sniffer misses some valid PDF and media files, for example a PDF with
// bytes before `%PDF`. Such a file arrives as `application/octet-stream`, and
// the file server sends its bytes with the type its name implies. These names
// open it in the viewer for that type. Images are left out: the sniffer
// recognises every web image, so an unsniffed `.png` is not a picture.
const VIEWER_EXTENSIONS = new Map<string, ViewerKind>([
  ['mp3', 'audio'],
  ['m4a', 'audio'],
  ['wav', 'audio'],
  ['ogg', 'audio'],
  ['oga', 'audio'],
  ['flac', 'audio'],
  ['mp4', 'video'],
  ['m4v', 'video'],
  ['webm', 'video'],
  ['ogv', 'video'],
  ['pdf', 'pdf'],
])

const UNSNIFFED = 'application/octet-stream'

/**
 * Media and PDF types win, because the browser draws them. A file with no
 * known type takes its viewer from its name. A file whose name or type says
 * text is shown as text, HTML included: an uploaded page is never rendered on
 * the app's origin. Any other file shows its preview image, if Drive made one,
 * or nothing.
 */
export function previewKind({ title, mime, hasPreview }: PreviewedFile): PreviewKind {
  const type = (mime ?? '').toLowerCase()
  const viewer =
    viewerKind(type) ?? (type === '' || type === UNSNIFFED ? viewerByName(title) : null)
  if (viewer) return { kind: viewer }
  const language = textLanguage(title, type)
  if (language) return { kind: 'text', language }
  return hasPreview ? { kind: 'image' } : { kind: 'none' }
}

function viewerKind(type: string): ViewerKind | null {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  if (type === 'application/pdf') return 'pdf'
  return null
}

function viewerByName(title: string): ViewerKind | null {
  return VIEWER_EXTENSIONS.get(titleExtension(title)?.toLowerCase() ?? '') ?? null
}

function textLanguage(title: string, type: string): TextLanguage | null {
  const extension = titleExtension(title)?.toLowerCase() ?? ''
  return EXTENSIONS.get(extension) ?? MIMES.get(type) ?? (type.startsWith('text/') ? 'plain' : null)
}
