import MailIcon from '@/apps/mail/AreaIcon.vue'
import { inboxSummary } from '@/apps/mail/client/inboxSummary'
import type { AreaDefinition } from '@/platform/contracts'
import { useQuery } from '@/platform/server-state'
import { translate as __ } from '@/platform/translation'

export const mailArea: AreaDefinition = {
  id: 'mail',
  label: () => __('Mail'),
  icon: MailIcon,
  to: '/mail',
  requires: ['jmap'],
  // Ticket 010 owns shell adoption. The existing MailLayout keeps its full frame for now.
  loadRoutes: () => import('@/apps/mail/routes'),
}

export type { MailSettingsTabId } from '@/apps/mail/utils/composables'

/** Mail's Settings group. Loads when Settings opens. */
export const loadMailSettings = () =>
  import('@/apps/mail/settings').then((module) => module.mailSettings)

export function useInboxSummary(enabled: () => boolean = () => true) {
  return useQuery(() => (enabled() ? inboxSummary() : false))
}
