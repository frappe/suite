import { translate as __ } from '@/platform/translation'

/**
 * Meet's Settings tabs, for the in-call and preview dialogs. Meet has no
 * group in the Suite Settings dialog: a device, background or layout choice
 * only means something inside a call.
 */
export const meetSettings = {
  label: () => __('Meet'),
  tabs: [
    {
      id: 'meet.devices',
      label: () => __('Devices'),
      icon: 'lucide-monitor-smartphone',
      body: () => import('@/apps/meet/components/settings/DeviceSettingsTab.vue'),
    },
    {
      id: 'meet.audio',
      label: () => __('Audio'),
      icon: 'lucide-audio-lines',
      body: () => import('@/apps/meet/components/settings/AudioSettingsTab.vue'),
    },
    {
      id: 'meet.video',
      label: () => __('Video'),
      icon: 'lucide-camera',
      body: () => import('@/apps/meet/components/settings/BackgroundSettingsTab.vue'),
    },
    {
      id: 'meet.notifications',
      label: () => __('Notifications'),
      icon: 'lucide-bell',
      body: () => import('@/apps/meet/components/settings/NotificationSettingsTab.vue'),
    },
    {
      id: 'meet.layout',
      label: () => __('Layout'),
      icon: 'lucide-layout-dashboard',
      body: () => import('@/apps/meet/components/settings/LayoutSettingsTab.vue'),
    },
  ],
} as const
