import { translate as __ } from '@/platform/translation'

const account = {
  label: () => __('Account'),
  tabs: [
    {
      id: 'account.profile',
      label: () => __('Profile'),
      icon: 'lucide-user',
      body: () => import('@/shell/settings/ProfileSettings.vue'),
      sections: [
        { id: 'name', label: () => __('Name') },
        { id: 'picture', label: () => __('Profile picture'), keywords: () => __('photo, avatar') },
        { id: 'password', label: () => __('Password') },
      ],
    },
    {
      id: 'account.preferences',
      label: () => __('Preferences'),
      icon: 'lucide-sliders-horizontal',
      body: () => import('@/shell/settings/PreferencesSettings.vue'),
      sections: [
        {
          id: 'appearance',
          label: () => __('Appearance'),
          keywords: () => __('theme, dark, light'),
        },
        { id: 'cursor', label: () => __('Cursor') },
        { id: 'language', label: () => __('Language') },
        { id: 'time-zone', label: () => __('Time zone') },
      ],
    },
  ],
} as const

export const loadAccountSettings = async () => account
