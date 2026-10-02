import type { DriveNode } from '@/apps/drive/client/types'
import { nodeIconTint } from '@/apps/drive/files/internal/icons'

// The route names a file by its mime family from the legacy mime table, and a
// content document by its content doctype. Both lists on the Statistics tab
// draw an item by its type, so a row and a file of that type look the same.
const TYPE_ICONS: Record<string, string> = {
  Image: 'lucide-image',
  Video: 'lucide-video',
  Audio: 'lucide-audio-lines',
  PDF: 'lucide-file',
  Archive: 'lucide-file-archive',
  Text: 'lucide-file-text',
  Code: 'lucide-file-code',
  Book: 'lucide-book',
  Document: 'lucide-file-text',
  'Writer Document': 'lucide-file-text',
  Spreadsheet: 'lucide-table',
  Sheet: 'lucide-table',
  Presentation: 'lucide-presentation',
}

type IconNode = Pick<DriveNode, 'kind' | 'mime' | 'content_doctype'>

// A node of each type that Drive tints, so a type takes the tint Drive gives
// its files. Any other type is gray there too.
const TYPE_NODES: Record<string, IconNode> = {
  Image: { kind: 'file', mime: 'image/png', content_doctype: null },
  PDF: { kind: 'file', mime: 'application/pdf', content_doctype: null },
  'Writer Document': { kind: 'document', mime: null, content_doctype: 'Writer Document' },
  Spreadsheet: { kind: 'document', mime: null, content_doctype: 'Spreadsheet' },
  Sheet: { kind: 'document', mime: null, content_doctype: 'Sheet' },
  Presentation: { kind: 'document', mime: null, content_doctype: 'Presentation' },
}

export function storageTypeIcon(type: string): string {
  return TYPE_ICONS[type] ?? 'lucide-file'
}

export function storageTypeTint(type: string): string {
  return nodeIconTint(TYPE_NODES[type] ?? { kind: 'file', mime: null, content_doctype: null })
}
