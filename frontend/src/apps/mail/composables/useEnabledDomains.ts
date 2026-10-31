import { computed, type Ref } from 'vue'

import { api, useQuery } from '@/api'

/** Disabled while the picker is closed; reopening follows the owner's freshness policy. */
export function useEnabledDomains(show: Ref<boolean | undefined>) {
  const domains = useQuery(api.mail.admin.domains.enabled, () => (show.value ? {} : false))
  const domainsError = computed(() => domains.error?.message ?? '')
  return { domains, domainsError }
}
