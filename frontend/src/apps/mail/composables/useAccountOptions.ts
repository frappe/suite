import { computed } from 'vue'

import { api, useQuery } from '@/api'

export function useAccountOptions() {
  const options = useQuery(api.mail.admin.members.options)
  const localeLabels = computed(
    () => new Map(options.data?.locales.map((option) => [option.value, option.label]) ?? []),
  )
  return {
    localeOptions: computed(() => options.data?.locales ?? []),
    localeLabel: (value?: string | null) => (value ? (localeLabels.value.get(value) ?? value) : ''),
    timeZoneOptions: computed(() => [
      { value: '', label: __('Not set') },
      ...(options.data?.time_zones ?? []),
    ]),
  }
}
