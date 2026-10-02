import type { DriveNode } from '@/apps/drive/client/types'
import { calendarDaysBetween } from '@/apps/drive/files/internal/format'
import { nodeTypeLabel } from '@/apps/drive/files/internal/icons'
import type { FilesGroup } from './presentation'

export interface DriveSection {
  heading: string
  rows: DriveNode[]
}

export function groupingHeading(node: DriveNode, group: Exclude<FilesGroup, 'none'>, now = new Date()): string {
  if (group === 'type') return `${nodeTypeLabel(node)}s`
  if (group === 'owner') return node.owner
  if (group === 'opened') {
    // Recent arrives newest first, so these two sections stay contiguous.
    const opened = node.opened_at ? new Date(node.opened_at) : null
    return opened && calendarDaysBetween(opened, now) <= 0 ? 'Today' : 'Earlier'
  }
  if (!node.modified) return 'Older'
  const days = calendarDaysBetween(new Date(node.modified), now)
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

