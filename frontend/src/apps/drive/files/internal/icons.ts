import type { DriveNode } from '@/apps/drive/client/types'

import { titleExtension } from './filename'
import { previewKind, type TextLanguage } from './previewKind'

import './icons.css'

/**
 * What Drive draws a node as. Each type has one icon, `file-icon-<type>`, and
 * one ink colour.
 */
export type FileType =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'csv'
  | 'code'
  | 'archive'
  | 'file'
  | 'link'

/**
 * What the type reads from. The title is required: a text file often has no
 * telling MIME type, so its extension decides what it is.
 */
type TypedNode = Pick<DriveNode, 'kind' | 'title' | 'mime' | 'content_doctype'>

interface StoredFile {
  type: FileType
  label: string
}

const CONTENT_TYPES: Record<string, FileType> = {
  'Writer Document': 'doc',
  // The Sheets surface registers 'Sheet'; 'Spreadsheet' is the older name and
  // still reaches rows created before it changed.
  Sheet: 'sheet',
  Spreadsheet: 'sheet',
  Presentation: 'slides',
}

/** Drive's own documents, PDFs and media each have a colour; everything else is gray. */
const TINTS: Record<FileType, string> = {
  folder: 'text-ink-gray-6',
  doc: 'text-ink-blue-6',
  sheet: 'text-ink-green-6',
  slides: 'text-ink-orange-6',
  pdf: 'text-ink-red-6',
  image: 'text-ink-violet-6',
  video: 'text-ink-pink-6',
  audio: 'text-ink-cyan-6',
  text: 'text-ink-gray-6',
  csv: 'text-ink-gray-6',
  code: 'text-ink-gray-6',
  archive: 'text-ink-gray-6',
  file: 'text-ink-gray-6',
  link: 'text-ink-gray-6',
}

/** Each language the text preview knows, by its usual name. */
const TEXT_TYPES: Record<TextLanguage, StoredFile> = {
  html: { label: 'HTML', type: 'code' },
  markdown: { label: 'Markdown', type: 'text' },
  javascript: { label: 'JavaScript', type: 'code' },
  typescript: { label: 'TypeScript', type: 'code' },
  json: { label: 'JSON', type: 'code' },
  css: { label: 'CSS', type: 'code' },
  scss: { label: 'SCSS', type: 'code' },
  python: { label: 'Python', type: 'code' },
  sql: { label: 'SQL', type: 'code' },
  xml: { label: 'XML', type: 'code' },
  yaml: { label: 'YAML', type: 'code' },
  plain: { label: 'Text', type: 'text' },
}

/**
 * A stored file's type. Drive records the MIME type it sniffs from the bytes,
 * and most text formats have no signature, so a Markdown or JSON file often
 * arrives as `application/octet-stream`; so does a PDF or video the sniffer
 * misses. The preview's classifier reads the name's extension for those, and
 * the listing asks it too, so the listing and the preview agree on what a
 * file is. Any other file is just a file.
 */
function storedFile({ title, mime }: TypedNode): StoredFile {
  const type = (mime ?? '').toLowerCase()
  const preview = previewKind({ title, mime, hasPreview: false })
  if (preview.kind === 'image') return { label: 'Image', type: 'image' }
  if (preview.kind === 'video') return { label: 'Video', type: 'video' }
  if (preview.kind === 'audio') return { label: 'Audio', type: 'audio' }
  if (preview.kind === 'pdf') return { label: 'PDF', type: 'pdf' }
  if (preview.kind === 'text') {
    const extension = titleExtension(title)?.toLowerCase()
    if (extension === 'csv' || type === 'text/csv') return { label: 'CSV', type: 'csv' }
    if (extension === 'tsv' || type === 'text/tab-separated-values')
      return { label: 'TSV', type: 'csv' }
    return TEXT_TYPES[preview.language]
  }
  if (type === 'application/zip') return { label: 'ZIP', type: 'archive' }
  if (type.includes('zip') || type.includes('compressed'))
    return { label: 'Archive', type: 'archive' }
  return { label: 'File', type: 'file' }
}

export function fileType(node: TypedNode): FileType {
  if (node.kind === 'folder') return 'folder'
  if (node.kind === 'link') return 'link'
  if (node.kind === 'document') return CONTENT_TYPES[node.content_doctype ?? ''] ?? 'file'
  return storedFile(node).type
}

/** The icon class for a type. */
export function fileTypeIcon(type: FileType): string {
  return `file-icon-${type}`
}

/** The ink class for a type. */
export function fileTypeTint(type: FileType): string {
  return TINTS[type]
}

export function nodeIcon(node: TypedNode): string {
  return fileTypeIcon(fileType(node))
}

export function nodeIconTint(node: TypedNode): string {
  return fileTypeTint(fileType(node))
}

export function nodeTypeLabel(node: TypedNode): string {
  if (node.kind === 'folder') return 'Folder'
  if (node.kind === 'link') return 'Link'
  if (node.kind === 'document') return node.content_doctype ?? 'Document'
  return storedFile(node).label
}
