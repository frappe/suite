import { formatBytes as formatDriveBytes } from '@/apps/drive/files/internal/format'

/** A byte count as people read it: `0 B`, `12.4 MB`. */
export function formatBytes(bytes: number): string {
  return formatDriveBytes(Math.max(0, bytes))
}

/**
 * A size inside a sentence: `1 GB`, `1.2 GB`. `roundUp` keeps a file just over
 * a limit from reading as the limit itself. `_readable_size` in
 * `suite/drive/_core/upload.py` words the server's copy of the same refusal
 * this way.
 */
export function formatSize(bytes: number, { roundUp = false }: { roundUp?: boolean } = {}): string {
  return formatDriveBytes(Math.max(0, bytes), { roundUp })
}
