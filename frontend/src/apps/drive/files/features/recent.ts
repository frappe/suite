import { computed } from 'vue'

import type { InfiniteQueryState } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'

/**
 * Recent as Drive shows it: the files the user opened, without the folders
 * they passed through. The `recents` view also records folder visits, and
 * other callers keep them, so the page filters here, while `applies()` holds.
 *
 * Only `rows` changes. A window that held only folders adds no rows, and the
 * listing then reads the next window as it does for access-filtered windows.
 */
export function recentFiles<Row extends DriveNode>(
  source: InfiniteQueryState<Row>,
  applies: () => boolean,
): InfiniteQueryState<Row> {
  const rows = computed(() => {
    const all = source.rows
    return applies() ? all.filter((row) => row.kind !== 'folder') : all
  })
  // Inherited getters and methods keep this listing as their receiver, while
  // every read still reaches the live source instead of a copied snapshot.
  return Object.create(source, {
    rows: { enumerable: true, get: () => rows.value },
  })
}
