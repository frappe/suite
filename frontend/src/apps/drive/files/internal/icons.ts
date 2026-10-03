import type { DriveNode } from '@/apps/drive/client/types'

import { titleExtension } from './filename'
import { previewKind, type TextLanguage } from './previewKind'

/** What the tint reads from: the kind, and a file's MIME type or a document's doctype. */
type TintedNode = Pick<DriveNode, 'kind' | 'mime' | 'content_doctype'>

/**
 * What the icon and type label read from. The title is required: a text file
 * often has no telling MIME type, so its extension decides what it is.
 */
type TypedNode = TintedNode & Pick<DriveNode, 'title'>

interface FileType {
  label: string
  icon: string
}

const CONTENT_ICONS: Record<string, string> = {
  'Writer Document': 'lucide-file-text',
  // The Sheets surface registers 'Sheet'; 'Spreadsheet' is the older name and
  // still reaches rows created before it changed.
  Sheet: 'lucide-table',
  Spreadsheet: 'lucide-table',
  Presentation: 'lucide-presentation',
}

/** One tint per kind, as the prototype paints them. */
const CONTENT_TINTS: Record<string, string> = {
  'Writer Document': 'text-ink-blue-6',
  Sheet: 'text-ink-green-6',
  Spreadsheet: 'text-ink-green-6',
  Presentation: 'text-ink-orange-6',
}

const CODE = 'lucide-file-code'
const TEXT = 'lucide-file-text'
/** Plain text that holds a table: CSV and TSV. */
const TABLE = 'lucide-file-spreadsheet'

/** Each language the text preview knows, by its usual name. */
const TEXT_TYPES: Record<TextLanguage, FileType> = {
  html: { label: 'HTML', icon: CODE },
  markdown: { label: 'Markdown', icon: TEXT },
  javascript: { label: 'JavaScript', icon: CODE },
  typescript: { label: 'TypeScript', icon: CODE },
  json: { label: 'JSON', icon: CODE },
  css: { label: 'CSS', icon: CODE },
  scss: { label: 'SCSS', icon: CODE },
  python: { label: 'Python', icon: CODE },
  sql: { label: 'SQL', icon: CODE },
  xml: { label: 'XML', icon: CODE },
  yaml: { label: 'YAML', icon: CODE },
  plain: { label: 'Text', icon: TEXT },
}

/**
 * A stored file's type. Drive records the MIME type it sniffs from the bytes,
 * and most text formats have no signature, so a Markdown or JSON file often
 * arrives as `application/octet-stream`. The text preview's classifier reads
 * the name's extension for those, so the listing and the preview agree on
 * what a file is. Any other file is just a file.
 */
function fileType({ title, mime }: TypedNode): FileType {
  const type = (mime ?? '').toLowerCase()
  if (type.startsWith('image/')) return { label: 'Image', icon: 'lucide-image' }
  if (type.startsWith('video/')) return { label: 'Video', icon: 'lucide-video' }
  if (type.startsWith('audio/')) return { label: 'Audio', icon: 'lucide-audio-lines' }
  if (type === 'application/pdf') return { label: 'PDF', icon: 'lucide-file' }
  const preview = previewKind({ title, mime, hasPreview: false })
  if (preview.kind === 'text') {
    const extension = titleExtension(title)?.toLowerCase()
    if (extension === 'csv' || type === 'text/csv') return { label: 'CSV', icon: TABLE }
    if (extension === 'tsv' || type === 'text/tab-separated-values')
      return { label: 'TSV', icon: TABLE }
    return TEXT_TYPES[preview.language]
  }
  if (type === 'application/zip') return { label: 'ZIP', icon: 'lucide-file-archive' }
  if (type.includes('zip') || type.includes('compressed'))
    return { label: 'Archive', icon: 'lucide-file-archive' }
  return { label: 'File', icon: 'lucide-file' }
}

export function nodeIcon(node: TypedNode): string {
  if (node.kind === 'folder') return 'lucide-folder'
  if (node.kind === 'link') return 'lucide-external-link'
  if (node.kind === 'document') return CONTENT_ICONS[node.content_doctype ?? ''] ?? 'lucide-file'
  return fileType(node).icon
}

export function nodeTypeLabel(node: TypedNode): string {
  if (node.kind === 'folder') return 'Folder'
  if (node.kind === 'link') return 'Link'
  if (node.kind === 'document') return node.content_doctype ?? 'Document'
  return fileType(node).label
}

export function nodeIconTint(node: TintedNode): string {
  if (node.kind === 'folder') return 'text-ink-gray-6'
  if (node.kind === 'document')
    return CONTENT_TINTS[node.content_doctype ?? ''] ?? 'text-ink-gray-6'
  if (node.mime === 'application/pdf') return 'text-ink-red-6'
  if (node.mime?.startsWith('image/')) return 'text-ink-violet-6'
  return 'text-ink-gray-6'
}
