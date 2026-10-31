import { computed } from 'vue'

import { api, useQuery } from '@/api'

export function useTimezones() {
  const query = useQuery(api.suite.locales.timezones)
  const timezones = computed(() => query.data?.timezones ?? [])
  const timezoneOptions = computed(() => timezones.value.map((value) => ({ label: value, value })))
  return { timezones, timezoneOptions }
}

// Browsers report legacy CLDR zone names; the framework list carries the renamed IDs.
const RENAMED_ZONES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
}

export function normalizeTimezone(zone: string): string {
  return RENAMED_ZONES[zone] ?? zone
}

export function detectTimezone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return normalizeTimezone(zone)
}
