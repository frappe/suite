import type { DriveNode } from '@/apps/drive/client/types'
import { nodeTypeLabel } from '@/apps/drive/files/internal/icons'
import type { FilesGroup } from './presentation'

export interface DriveSection {
  heading: string
  rows: DriveNode[]
}

export function groupingHeading(node: DriveNode, group: Exclude<FilesGroup, 'none'>, now = new Date()): string {
  if (group === 'type') return `${nodeTypeLabel(node)}s`
  if (group === 'owner') return node.owner
  if (!node.modified) return 'Older'
  const modified = new Date(node.modified)
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(modified).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days < 7) return 'This week'
  if (days < 31) return 'This month'
  return 'Older'
}

export function groupContiguous(rows: DriveNode[], group: FilesGroup): DriveSection[] {
  if (group === 'none') return [{ heading: '', rows }]
  const sections: DriveSection[] = []
  for (const row of rows) {
    const heading = groupingHeading(row, group)
    const last = sections.at(-1)
    if (last?.heading === heading) last.rows.push(row)
    else sections.push({ heading, rows: [row] })
  }
  return sections
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

