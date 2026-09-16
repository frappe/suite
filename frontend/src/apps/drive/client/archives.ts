import { mutation, query } from '@/platform/server-state'

import { api } from './generated'
import { driveOperation } from './operation'

export interface ArchiveStatus {
  status: 'building' | 'ready' | 'failed'
  file_name: string | null
  size: number | null
  error: string | null
}

const startOperation = driveOperation<{ node: string }, ArchiveStatus>(api.node_archive_start)
const statusOperation = driveOperation<{ node: string }, ArchiveStatus>(api.node_archive_status)

export const startArchive = () => mutation(startOperation, { touches: ({ node }) => [node] })
export const archiveStatus = (node: string) => query(statusOperation, { node }, { refetchInterval: 2_000 })

export function archiveDownloadUrl(node: string): string {
  return `/api/suite/drive/nodes/${encodeURIComponent(node)}/archive/download`
}

