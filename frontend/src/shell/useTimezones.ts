import { computed, ref } from 'vue'
import { createResource } from 'frappe-ui'

const timezones = ref<string[]>([])

let fetched = false

export function useTimezones() {
  if (!fetched) {
    fetched = true
    createResource({
      url: 'frappe.core.doctype.user.user.get_timezones',
      auto: true,
      onSuccess: (data: { timezones: string[] }) => (timezones.value = data.timezones),
    })
  }

  const timezoneOptions = computed(() => timezones.value.map((tz) => ({ label: tz, value: tz })))

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
