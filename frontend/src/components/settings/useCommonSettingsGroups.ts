import { computed, markRaw } from 'vue'
import { Settings, SlidersHorizontal, User, Users } from 'lucide-vue-next'

import { useCurrentUser } from '@/boot/session'
import type { SettingsGroup } from '@/components/settings/types'
import PreferencesSettings from '@/shell/settings/PreferencesSettings.vue'
import ProfileSettings from '@/shell/settings/ProfileSettings.vue'
import WorkspaceGeneralSettings from '@/shell/settings/WorkspaceGeneralSettings.vue'
import WorkspaceUsersSettings from '@/shell/settings/WorkspaceUsersSettings.vue'

// The legacy lists (Mail and Calendar profile pages, the legacy Drive dialog)
// read these groups until those surfaces move to the shell settings list.
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
          component: markRaw(ProfileSettings),
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
          component: markRaw(WorkspaceGeneralSettings),
        },
        {
          label: 'Users',
          value: 'workspace-users',
          icon: Users,
          component: markRaw(WorkspaceUsersSettings),
        },
      ],
    },
  ])
}
