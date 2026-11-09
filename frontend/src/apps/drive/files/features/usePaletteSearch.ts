import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import { api, useQuery } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'
import { nodeIcon, nodeIconTint } from '@/apps/drive/files/internal/icons'
import { locationTitle } from '@/apps/drive/files/internal/locations'
import type { PaletteSearch } from '@/platform/contracts'

const RESULT_LIMIT = 20

/**
 * Drive's search view, as palette rows: files, folders and documents by name,
 * each with its type icon and the folder it is in. A link is left out: opening
 * one leaves Suite, and the listing asks before it does.
 */
export function usePaletteSearch(
  term: () => string | false,
  routeOf: (node: DriveNode) => RouteLocationRaw,
): PaletteSearch {
  const found = useQuery(api.drive.views.list, () => {
    const text = term()
    return text ? { view: 'search', term: text, limit: RESULT_LIMIT, expand: 'breadcrumbs' } : false
  })
  // The caller's own roots read as the sidebar names them, such as "My files".
  const roots = useQuery(api.drive.roots.list, () => (term() ? {} : false))
  const results = computed(() =>
    (found.data?.rows ?? [])
      .filter((row): row is DriveNode => 'name' in row && row.kind !== 'link')
      .map((node) => {
        const parent = node.breadcrumbs?.at(-1)
        return {
          id: node.name,
          title: node.title,
          icon: `${nodeIcon(node)} ${nodeIconTint(node)}`,
          location: parent ? locationTitle(parent, roots.data) : undefined,
          to: routeOf(node),
        }
      }),
  )
  return {
    get results() {
      return results.value
    },
    get isFetching() {
      return found.isFetching
    },
    cancel: () => found.cancel(),
  }
}
