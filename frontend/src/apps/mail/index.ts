import { defineAsyncComponent, getCurrentInstance, onScopeDispose, watch } from 'vue'

import { api, useQuery } from '@/api'
import MailIcon from '@/apps/mail/AreaIcon.vue'
import type { MountedComposeHost } from '@/apps/mail/composables/mountComposeHost'
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
  // On a phone, Mail is a row in the account sheet, not a bottom bar tab.
  phonePlacement: 'account',
  menuIcon: 'lucide-mail',
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

export interface MailCompose {
  /** Opens Mail's composer addressed to `to`. Resolves once it has been asked to open. */
  compose(to: readonly string[]): Promise<void>
}

/**
 * Writes to people from another app without leaving it: Mail's compose window opens over the page
 * on a desktop, and on a phone Mail's compose page opens, which Back leaves for the page it came
 * from. Either way it is Mail's composer, addressed to `to`, writing as Mail's active account.
 * Mail's code loads on the first `compose`, not before. Call it in a component's setup.
 */
export function useMailCompose(): MailCompose {
  const context = getCurrentInstance()?.appContext
  if (!context) throw new Error('useMailCompose() must be called in a component setup')
  let host: Promise<MountedComposeHost> | undefined
  let disposed = false
  // The window belongs to the page that opened it, as Mail's belongs to Mail: leaving the page
  // closes it, and a draft in it is kept, as closing it would keep it.
  onScopeDispose(() => {
    disposed = true
    void host?.then((mounted) => mounted.unmount())
  })
  return {
    compose: async (to) => {
      if (disposed) return
      host ??= import('@/apps/mail/composables/mountComposeHost').then((module) =>
        module.mountComposeHost(context),
      )
      ;(await host).compose(to)
    },
  }
}
