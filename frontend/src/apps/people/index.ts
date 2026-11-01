import PeopleIcon from '@/apps/people/AreaIcon.vue'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

/** A mail account's contacts and address books. They live on the mail server, so People needs Mail. */
export const peopleArea: AreaDefinition = {
  id: 'people',
  label: () => __('People'),
  icon: PeopleIcon,
  to: '/people',
  requires: ['jmap'],
  loadRoutes: () => import('@/apps/people/routes'),
}
