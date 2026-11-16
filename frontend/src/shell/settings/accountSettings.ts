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
    {
      id: 'account.security',
      label: () => __('Security'),
      icon: 'lucide-shield',
      body: () => import('@/shell/settings/SecuritySettings.vue'),
    },
  ],
} as const

export const loadAccountSettings = async () => account
