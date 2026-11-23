import { computed, ref } from 'vue'

import { api, client, useQuery } from '@/api'
import { userStore } from '@/apps/mail/stores/user'

interface Region {
  locale: string
  time_zone: string
}

// The newest choice while a save is out. Kept past the page: a choice is still being saved when
// its page goes, and one made behind it waits its turn, so the saved read shows neither yet
const choice = ref<Region>()
let saves = 0
async function save(region: Region) {
  choice.value = region
  saves += 1
  try {
    // Not a component's mutation: that one is cancelled when its page goes
    await client.mutation(api.mail.settings.updateRegional, region)
  } catch {
    // The refusal is reported where every failed save is, and the saved read is put back
  }

  saves -= 1
  if (saves === 0) {
    choice.value = undefined
  }
}

/**
 * The mail provider's own locale and time zone, each saved as it is chosen; a site without a
 * provider has neither. A choice shows at once, and goes back to the saved one when its save is
 * refused.
 */
export function useRegionalPreferences() {
  const user = userStore().userResource
  const hasProvider = computed(() => !!user.data?.is_suite_cloud_configured)
  const regional = useQuery(api.mail.settings.regional, () => hasProvider.value && {})
  function shown(): Region | undefined {
    const saved = regional.data
    return choice.value ?? (saved && { locale: saved.locale, time_zone: saved.time_zone })
  }

  const region = computed(shown)
  // The control can also hand back nothing; a name is all there is to save
  async function change(field: keyof Region, value: unknown) {
    if (!region.value || typeof value !== 'string') return

    await save({ ...region.value, [field]: value })
  }

  return { hasProvider, regional, region, change }
}
