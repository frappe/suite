import type { DriveNode } from '@/apps/drive/client/types'

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

export function nodeIcon(node: Pick<DriveNode, 'kind' | 'mime' | 'content_doctype'>): string {
  if (node.kind === 'folder') return 'lucide-folder'
  if (node.kind === 'link') return 'lucide-external-link'
  if (node.kind === 'document') return CONTENT_ICONS[node.content_doctype ?? ''] ?? 'lucide-file'
  if (node.mime?.startsWith('image/')) return 'lucide-image'
  if (node.mime?.startsWith('video/')) return 'lucide-video'
  if (node.mime?.startsWith('audio/')) return 'lucide-audio-lines'
  if (node.mime === 'application/pdf') return 'lucide-file'
  if (node.mime?.includes('zip') || node.mime?.includes('compressed')) return 'lucide-file-archive'
  return 'lucide-file'
}

export function nodeTypeLabel(node: Pick<DriveNode, 'kind' | 'mime' | 'content_doctype'>): string {
  if (node.kind === 'folder') return 'Folder'
  if (node.kind === 'link') return 'Link'
  if (node.kind === 'document') return node.content_doctype ?? 'Document'
  if (node.mime === 'application/pdf') return 'PDF'
  return node.mime?.split('/')[0]?.replace(/^./, (letter) => letter.toUpperCase()) || 'File'
}

export function nodeIconTint(
  node: Pick<DriveNode, 'kind' | 'mime' | 'content_doctype'>,
): string {
  if (node.kind === 'folder') return 'text-ink-gray-6'
  if (node.kind === 'document')
    return CONTENT_TINTS[node.content_doctype ?? ''] ?? 'text-ink-gray-6'
  if (node.mime === 'application/pdf') return 'text-ink-red-6'
  if (node.mime?.startsWith('image/')) return 'text-ink-violet-6'
  return 'text-ink-gray-6'
}
