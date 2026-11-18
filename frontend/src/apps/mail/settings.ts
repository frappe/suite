import { defineComponent, h, type Component } from 'vue'

import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

type BodyModule = { default: Component }

/** Wraps a Mail tab body in the Mail injections, loaded with the body. */
function scoped(load: () => Promise<BodyModule>, options: { socket?: boolean } = {}) {
  return async (): Promise<Component> => {
    const [{ default: Body }, { default: Scope }] = await Promise.all([
      load(),
      import('@/apps/mail/components/Settings/MailSettingsScope.vue'),
    ])
    return defineComponent({
      name: 'MailSettingsTab',
      setup: () => () => h(Scope, { socket: options.socket }, { default: () => h(Body) }),
    })
  }
}

export const mailSettings = {
  label: () => __('Mail'),
  area: 'mail',
  condition: () => useSession().capabilities.value.jmap,
  tabs: [
    {
      id: 'mail.general',
      label: () => __('General'),
      icon: 'lucide-mailbox',
      body: scoped(() => import('@/apps/mail/components/Settings/MailGeneralSettings.vue')),
      sections: [
        { id: 'storage', label: () => __('Storage'), keywords: () => __('quota, space') },
        { id: 'split-view', label: () => __('Split view'), keywords: () => __('reading pane') },
        { id: 'group-by-date', label: () => __('Group by date') },
        { id: 'remote-images', label: () => __('Block remote images') },
        { id: 'locale', label: () => __('Locale') },
        { id: 'time-zone', label: () => __('Time zone') },
      ],
    },
    {
      id: 'mail.sending',
      label: () => __('Sending'),
      icon: 'lucide-send',
      body: scoped(() => import('@/apps/mail/components/Settings/MailSendingSettings.vue')),
      sections: [
        { id: 'undo-send', label: () => __('Undo send') },
        { id: 'create-contacts', label: () => __('Add recipients to contacts') },
        { id: 'forwarded', label: () => __('Keep forwards in the conversation') },
        {
          id: 'send-as',
          label: () => __('Send-as addresses'),
          keywords: () => __('identity, alias, from, default address'),
        },
        { id: 'signatures', label: () => __('Signatures') },
        {
          id: 'auto-reply',
          label: () => __('Auto-reply'),
          keywords: () => __('vacation, out of office, away'),
        },
      ],
    },
    {
      id: 'mail.inbox',
      label: () => __('Inbox'),
      icon: 'lucide-inbox',
      body: scoped(() => import('@/apps/mail/components/Settings/MailInboxSettings.vue')),
      sections: [
        { id: 'screening', label: () => __('Screen new senders'), keywords: () => __('screener') },
        { id: 'on-block', label: () => __('When blocking a sender'), keywords: () => __('junk') },
        {
          id: 'screened-senders',
          label: () => __('Screened senders'),
          keywords: () => __('block list, blocked, accepted'),
        },
        {
          id: 'categories',
          label: () => __('Split Inbox into categories'),
          keywords: () => __('tabs'),
        },
        { id: 'folders', label: () => __('Folders') },
        { id: 'rules', label: () => __('Rules'), keywords: () => __('filters, sieve') },
      ],
    },
    {
      id: 'mail.import-export',
      label: () => __('Import and export'),
      icon: 'lucide-arrow-down-up',
      // Import and export report their progress over the socket
      body: scoped(() => import('@/apps/mail/components/Settings/MailImportExportSettings.vue'), {
        socket: true,
      }),
      sections: [
        { id: 'import', label: () => __('Import') },
        { id: 'export', label: () => __('Export'), keywords: () => __('download, backup') },
      ],
    },
    {
      id: 'mail.advanced',
      label: () => __('Advanced'),
      icon: 'lucide-code',
      body: scoped(() => import('@/apps/mail/components/Settings/MailAdvancedSettings.vue')),
      sections: [
        {
          id: 'login-details',
          label: () => __('Login details'),
          keywords: () => __('username, app password'),
        },
        {
          id: 'client-setup',
          label: () => __('Mail client setup'),
          keywords: () => __('IMAP, SMTP, POP'),
        },
        { id: 'api-access', label: () => __('API access'), keywords: () => __('API key') },
        {
          id: 'push-subscriptions',
          label: () => __('Push subscriptions'),
          keywords: () => __('notifications, devices'),
        },
        { id: 'sent-mail', label: () => __('Delete mail once it is sent') },
        { id: 'sent-newsletters', label: () => __('Delete newsletters once they are sent') },
      ],
    },
  ],
} as const
