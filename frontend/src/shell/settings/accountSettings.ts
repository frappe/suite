import { translate as __ } from '@/platform/translation'

export const accountSettings = {
  label: () => __('Account'),
  tabs: [
    {
      id: 'account.profile',
      label: () => __('Profile'),
      icon: 'lucide-user',
      body: () => import('@/shell/settings/ProfileSettings.vue'),
      sections: [
        { id: 'name', label: () => __('Name'), keywords: () => __('first name, last name') },
        { id: 'picture', label: () => __('Profile picture'), keywords: () => __('photo, avatar') },
        {
          id: 'password',
          label: () => __('Password'),
          description: () => __('Manage password and account access.'),
        },
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
          description: () => __('Choose a light, dark or system-matched interface.'),
          keywords: () => __('theme, dark, light'),
        },
        {
          id: 'cursor',
          label: () => __('Cursor'),
          description: () =>
            __('Show the hand cursor on every control, or only on links that leave the app.'),
        },
        {
          id: 'language',
          label: () => __('Language'),
          description: () => __('The language that the interface is shown in.'),
        },
        {
          id: 'time-zone',
          label: () => __('Time zone'),
          description: () => __('Your local time zone for dates and times.'),
        },
      ],
    },
  ],
} as const
