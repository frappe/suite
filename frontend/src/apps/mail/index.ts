import { defineAsyncComponent, getCurrentInstance, onScopeDispose, watch } from 'vue'

import { api, useQuery } from '@/api'
import MailIcon from '@/apps/mail/AreaIcon.vue'
import type { MountedComposeHost } from '@/apps/mail/composables/mountComposeHost'
import { showMailReminder } from '@/apps/mail/reminders'
import type { MailRecipient } from '@/apps/mail/types'
import type { AreaDefinition } from '@/platform/contracts'
import { toast } from '@/platform/feedback'
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
  phoneNavFloats: true,
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

/** Unread Inbox mail across the reader's accounts, and in each. */
export type InboxSummary = import('@/apps/mail/client/generated').InboxSummaryOutput

export function useInboxSummary(enabled: () => boolean = () => true) {
  return useQuery(api.mail.inbox.summary, () => (enabled() ? {} : false))
}

export type { MailRecipient } from '@/apps/mail/types'
export { composeLink } from '@/apps/mail/utils/composeLink'

interface MailCompose {
  /**
   * Opens Mail's composer addressed to `to`, less the reader's own addresses. Resolves once it has
   * been asked to open, or once the failure to load Mail's code has been said.
   */
  compose(to: readonly MailRecipient[]): Promise<void>
}

/**
 * Writes to people from another app, on a desktop, without leaving the page: Mail's compose window
 * opens over it, writing as Mail's active account, to everyone but the reader; with no Mail
 * account, the device's mail app gets the same people. Mail's code loads on the first `compose`,
 * not before. A phone has no window: the caller goes by `composeLink` instead, which loads nothing
 * (should a phone call this all the same, Mail's host follows that link). Call it in a component's
 * setup.
 */
export function useMailCompose(): MailCompose {
  const context = getCurrentInstance()?.appContext
  if (!context) throw new Error('useMailCompose() must be called in a component setup')
  let host: Promise<MountedComposeHost> | undefined
  let disposed = false
  // The window belongs to the page that opened it, as Mail's belongs to Mail: leaving the page
  // closes it, and a draft in it is kept, as closing it would keep it. A load still going when the
  // page goes is let go, whether it lands or fails: the press that started it has said a failure.
  onScopeDispose(() => {
    disposed = true
    void host?.then(
      (mounted) => mounted.unmount(),
      () => {},
    )
  })
  const mount = () =>
    import('@/apps/mail/composables/mountComposeHost').then((module) =>
      module.mountComposeHost(context),
    )
  return {
    compose: async (to) => {
      // A load that failed (a dropped connection, or a deploy since the page loaded) is not kept:
      // the next press tries again.
      host ??= mount().catch((error: unknown) => {
        host = undefined
        throw error
      })
      let mounted: MountedComposeHost
      try {
        mounted = await host
      } catch (error) {
        console.error('Could not load Mail’s composer', error)
        toast.error(__('Mail could not open. Check your connection and try again.'))
        return
      }
      if (!disposed) await mounted.compose(to)
    },
  }
}
