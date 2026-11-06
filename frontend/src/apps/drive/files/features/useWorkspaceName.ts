import { computed, type ComputedRef } from 'vue'

import { api, useQuery } from '@/api'
import { useTweak } from '@/platform/tweaks'

/**
 * The workspace name that names everyone at the org, while t4-access-words is
 * on. Empty while unknown or with the tweak off. The server page boots the
 * name; the Vite dev page does not, so this asks the site. Call it in a
 * component's setup.
 */
export function useWorkspaceName(): ComputedRef<string> {
  const accessWords = useTweak('t4-access-words')
  const site = useQuery(api.suite.site.get, () =>
    accessWords.value && window.suite_workspace_name === undefined ? {} : false,
  )
  return computed(() =>
    accessWords.value ? (window.suite_workspace_name ?? site.data?.workspace_name ?? '') : '',
  )
}
