import { computed } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import type { QueryResult } from '@/platform/server-state'

/**
 * Recent as Drive shows it: the files the user opened, without the folders
 * they passed through. The `recents` view also records folder visits, and
 * other callers keep them, so the page filters here, while `applies()` holds.
 *
 * Only `rows` changes. A window that held only folders adds no rows, and the
 * listing then reads the next window as it does for access-filtered windows.
 */
export function recentFiles<Page extends { rows: DriveNode[] }>(source: QueryResult<Page>, applies: () => boolean): QueryResult<Page> {
  const rows = computed(() => {
    const all = source.rows as DriveNode[]
    return applies() ? all.filter((row) => row.kind !== 'folder') : all
  })
  return new Proxy(source, {
    get(target, key, receiver) {
      return key === 'rows' ? rows.value : Reflect.get(target, key, receiver)
    },
  })
}
