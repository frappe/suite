import { defineAsyncComponent, watch } from 'vue'

import { api, useQuery } from '@/api'
import MailIcon from '@/apps/mail/AreaIcon.vue'
import { showMailReminder } from '@/apps/mail/reminders'
import type { AreaDefinition } from '@/platform/contracts'
import { realtime } from '@/platform/realtime'
import type { Reminder } from '@/platform/reminders'
import { hasCapabilities, useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

export const mailArea: AreaDefinition = {
  id: 'mail',
  label: () => __('Mail'),
  icon: MailIcon,
  to: '/mail',
  requires: ['jmap'],
  installable: true,
  phoneNav: defineAsyncComponent(() => import('@/apps/mail/components/mobile/MailTabBar.vue')),
  // Ticket 010 owns shell adoption. The existing MailLayout keeps its full frame for now.
  loadRoutes: () => import('@/apps/mail/routes'),
}

export type { MailSettingsTabId } from '@/apps/mail/utils/composables'

/**
 * Shows each reminder the server sends (`mail_reminder`) on every page, for a signed-in reader who
 * has Mail, on the shell's one realtime connection. Call it once at boot.
 */
export function installMailReminders({ open }: { open: (path: string) => void }): () => void {
  const session = useSession()
  let stopListening: (() => void) | undefined
  const stopWatching = watch(
    () => session.status.value === 'authenticated' && hasCapabilities(mailArea.requires, session),
    (hasMail) => {
      stopListening?.()
      stopListening = hasMail
        ? realtime.subscribe<Reminder>('mail_reminder', (reminder) => {
            void showMailReminder(reminder, open)
          })
        : undefined
    },
    { immediate: true },
  )
  return () => {
    stopWatching()
    stopListening?.()
  }
}

/** Mail's Settings group. Loads when Settings opens. */
export const loadMailSettings = () =>
  import('@/apps/mail/settings').then((module) => module.mailSettings)

export const loadMailAdminRoutes = () => import('@/apps/mail/adminRoutes')
export const loadMailAdminUsers = () => import('@/apps/mail/pages/dashboard/AdminUsersView.vue')
export const loadStorageLimitDialog = () =>
  import('@/apps/mail/components/Modals/StorageLimitDialog.vue')

export function useInboxSummary(enabled: () => boolean = () => true) {
  return useQuery(api.mail.inbox.summary, () => (enabled() ? {} : false))
}
