import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

import AdminIcon from './AdminIcon.vue'

export const adminArea: AreaDefinition = {
  id: 'admin',
  label: () => __('Admin'),
  icon: AdminIcon,
  to: '/admin',
  requires: ['suiteAdmin'],
  loadRoutes: () => import('./routes'),
}
