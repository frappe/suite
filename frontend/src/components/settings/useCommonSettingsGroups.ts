import { computed, markRaw } from 'vue'
import { Settings, SlidersHorizontal, User } from 'lucide-vue-next'

import { useCurrentUser } from '@/boot/session'
import UserProfileSettings from '@/components/settings/UserProfileSettings.vue'
import type { SettingsGroup } from '@/components/settings/types'
import PreferencesSettings from '@/shell/settings/PreferencesSettings.vue'
import WorkspaceSettings from '@/shell/settings/WorkspaceSettings.vue'

export function useCommonSettingsGroups() {
  const { isSystemManager } = useCurrentUser()

  return computed<SettingsGroup[]>(() => [
    {
      id: 'account',
      label: 'Account',
      items: [
        {
          label: 'Profile',
          value: 'profile',
          icon: User,
          component: markRaw(UserProfileSettings),
        },
        {
          label: 'Preferences',
          value: 'preferences',
          icon: SlidersHorizontal,
          component: markRaw(PreferencesSettings),
        },
      ],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      condition: () => isSystemManager.value,
      items: [
        {
          label: 'General',
          value: 'workspace',
          icon: Settings,
          component: markRaw(WorkspaceSettings),
        },
      ],
    },
  ])
}
