import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

const account = {
  label: () => __('Account'),
  tabs: [
    {
      id: 'account.profile',
      label: () => __('Profile'),
      icon: 'lucide-user',
      body: () => import('@/shell/settings/ProfileSettings.vue'),
    },
    {
      id: 'account.preferences',
      label: () => __('Preferences'),
      icon: 'lucide-sliders-horizontal',
      body: () => import('@/shell/settings/PreferencesSettings.vue'),
    },
  ],
} as const

const workspace = {
  label: () => __('Workspace'),
  condition: () => useSession().capabilities.value.systemManager,
  tabs: [
    {
      id: 'workspace.general',
      label: () => __('General'),
      icon: 'lucide-settings',
      body: () => import('@/shell/settings/WorkspaceGeneralSettings.vue'),
    },
    {
      id: 'workspace.users',
      label: () => __('Users'),
      icon: 'lucide-users',
      body: () => import('@/shell/settings/WorkspaceUsersSettings.vue'),
    },
  ],
} as const

export const loadAccountSettings = async () => account
export const loadWorkspaceSettings = async () => workspace
