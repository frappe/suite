import PeopleIcon from '@/apps/people/AreaIcon.vue'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

/**
 * A mail account's contacts and address books. They live on the mail server, so People needs Mail.
 * Its entry is a row in the account menu rather than a rail item [Faris, 2026-11-16].
 */
export const peopleArea: AreaDefinition = {
  id: 'people',
  label: () => __('People'),
  icon: PeopleIcon,
  to: '/people',
  placement: 'account',
  menuIcon: 'lucide-users',
  requires: ['jmap'],
  loadRoutes: () => import('@/apps/people/routes'),
}
