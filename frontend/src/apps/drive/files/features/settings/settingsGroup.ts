import { translate as __ } from '@/platform/translation'

export const driveSettings = {
  label: () => __('Drive'),
  area: 'files',
  tabs: [
    {
      id: 'drive.statistics',
      // The id stays, so saved links to the tab still open it.
      label: () => __('Storage'),
      icon: 'lucide-chart-pie',
      body: () => import('./StatisticsSettings.vue'),
    },
  ],
} as const
