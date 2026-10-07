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
  return new Proxy(source, {
    get(target, key, receiver) {
      return key === 'rows' ? rows.value : Reflect.get(target, key, receiver)
    },
  })
}
