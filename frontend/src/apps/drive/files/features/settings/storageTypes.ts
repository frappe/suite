import type { LargestFile } from '@/apps/drive/client/settings'
import type { DriveNode } from '@/apps/drive/client/types'

// The route names a file by its mime family from the legacy mime table, and a
// content document by its content doctype.
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

export function storageTypeIcon(type: string): string {
  return TYPE_ICONS[type] ?? 'lucide-file'
}

/** The node fields the shared icon helpers read. A document's type is its content doctype. */
export function largestFileNode(file: LargestFile): Pick<DriveNode, 'kind' | 'mime' | 'content_doctype'> {
  return {
    kind: file.kind,
    mime: file.mime,
    content_doctype: file.kind === 'document' ? file.type : null,
  }
}
