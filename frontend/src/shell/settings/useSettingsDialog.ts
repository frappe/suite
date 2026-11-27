import { computed, inject, type Ref } from 'vue'

import {
  SETTINGS_GROUPS_KEY,
  visibleSettingsGroups,
  type SettingsGroup,
  type VisibleSettingsGroup,
} from '@/shell/settings/settings'
import { isMobile } from '@/shell/useIsMobile'

export { openSettings, openSettingsPage, settingsTab, showSettings } from '@/platform/settings'

interface UseSettingsGroupsResult {
  groups: Readonly<Ref<VisibleSettingsGroup[]>>
  refresh: () => Promise<void>
}

/**
 * The settings groups the user may see. The list is part of the app, so it is there at once; its
 * conditions are reactive, so a row shows or goes as what it reads changes. `refresh()` reads the
 * server answers some conditions depend on again: call it when Settings opens.
 */
export function useSettingsGroups(
  all: readonly SettingsGroup[] = inject(SETTINGS_GROUPS_KEY, []),
): UseSettingsGroupsResult {
  const groups = computed(() => visibleSettingsGroups(all, { phone: isMobile.value }))

  async function refresh() {
    await Promise.allSettled(all.map((group) => group.refresh?.()))
  }

  return { groups, refresh }
}
