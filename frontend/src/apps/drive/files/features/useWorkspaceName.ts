import { computed, type ComputedRef } from 'vue'

import { api, useQuery } from '@/api'

/**
 * The workspace name that names everyone at the org. Empty while unknown. The
 * server page boots the name; the Vite dev page does not, so this asks the
 * site. Call it in a component's setup.
 */
export function useWorkspaceName(): ComputedRef<string> {
  const site = useQuery(api.suite.site.get, () =>
    window.suite_workspace_name === undefined ? {} : false,
  )
  return computed(() => window.suite_workspace_name ?? site.data?.workspace_name ?? '')
}
