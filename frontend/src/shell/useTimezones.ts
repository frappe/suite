import { computed } from 'vue'

import { api, useQuery } from '@/api'

export function useTimezones() {
  const query = useQuery(api.suite.locales.timezones)
  const timezones = computed(() => query.data?.timezones ?? [])
  const timezoneOptions = computed(() => timezones.value.map((value) => ({ label: value, value })))
  return { timezones, timezoneOptions }
}
