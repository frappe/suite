export type { NodeArchiveStatusOutput as ArchiveStatus } from './generated'
export function archiveDownloadUrl(node: string): string {
  return `/api/suite/drive/nodes/${encodeURIComponent(node)}/archive/download`
}
