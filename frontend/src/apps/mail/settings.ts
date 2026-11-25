import { defineComponent, h, type Component } from 'vue'

import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

type BodyModule = { default: Component }

/** Wraps a Mail tab body in the Mail injections, loaded with the body. */
function scoped(load: () => Promise<BodyModule>, options: { socket?: boolean } = {}) {
  return async (): Promise<Component> => {
    const [{ default: Body }, { default: Scope }] = await Promise.all([
      load(),
      import('@/apps/mail/components/MailScope.vue'),
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
      label: () => __('Layout'),
      icon: 'lucide-layout-panel-left',
      // The list's layout is a computer's; a phone has one layout.
      onPhone: false,
      body: scoped(() => import('@/apps/mail/components/Settings/MailGeneralSettings.vue')),
      sections: [
        {
          id: 'split-view',
          label: () => __('Split view'),
          description: () => __('Preview a message beside the list.'),
          keywords: () => __('reading pane'),
        },
        {
          id: 'group-by-date',
          label: () => __('Group by date'),
          description: () => __('Show the list under date headings such as Today and Yesterday.'),
        },
      ],
    },
    {
      id: 'mail.inbox',
      label: () => __('Incoming'),
      icon: 'lucide-inbox',
      body: scoped(() => import('@/apps/mail/components/Settings/MailInboxSettings.vue')),
      sections: [
        {
          id: 'categories',
          label: () => __('Split Inbox into categories'),
          description: () =>
            __('Mail that isn’t personal moves out of Primary into its own category.'),
          keywords: () => __('tabs'),
        },
        {
          id: 'screened-senders',
          label: () => __('Screened senders'),
          description: () => __('The senders and domains you accept or block.'),
          keywords: () => __('block list, blocked, accepted'),
        },
        {
          id: 'on-block',
          label: () => __('When blocking a sender'),
          description: () => __('What to do with their mail already in your Inbox.'),
          keywords: () => __('junk, screener'),
        },
        {
          id: 'remote-images',
          label: () => __('Block remote images'),
          description: () => __('Don’t load remote images from untrusted sources by default.'),
        },
      ],
    },
    {
      id: 'mail.sending',
      label: () => __('Outgoing'),
      icon: 'lucide-send',
      body: scoped(() => import('@/apps/mail/components/Settings/MailSendingSettings.vue')),
      sections: [
        {
          id: 'send-as',
          label: () => __('Send-as addresses'),
          description: () =>
            __('The addresses you send mail as, each with its own name and signature.'),
          keywords: () => __('identity, alias, from, default address'),
        },
        {
          id: 'signatures',
          label: () => __('Signatures'),
          description: () => __('Text added to the end of the messages you send.'),
        },
        {
          id: 'undo-send',
          label: () => __('Undo send'),
          description: () =>
            __('How long a sent message waits before delivery, so you can still take it back.'),
        },
        {
          id: 'create-contacts',
          label: () => __('Add recipients to contacts'),
          description: () => __('Saves anyone you write to as a contact, if they are not one yet.'),
        },
        {
          id: 'forwarded',
          label: () => __('Keep forwards in the conversation'),
          description: () => __('A message you forward stays in the conversation it came from.'),
        },
        {
          id: 'sent-mail',
          label: () => __('Don’t keep sent mail'),
          description: () =>
            __(
              'Mail you send isn’t saved in Sent, so you can’t find it, forward it or reply from it later.',
            ),
          keywords: () => __('delete, sent folder, copy'),
        },
        {
          id: 'sent-newsletters',
          label: () => __('Don’t keep sent newsletters'),
          description: () =>
            __('Bulk mail your apps send through this account isn’t saved in Sent.'),
          keywords: () => __('delete, sent folder, bulk'),
        },
        {
          id: 'auto-reply',
          label: () => __('Auto-reply'),
          description: () => __('Answers mail for you while you are away.'),
          keywords: () => __('vacation, out of office, away'),
        },
      ],
    },
    {
      id: 'mail.folders',
      label: () => __('Folders'),
      icon: 'lucide-folders',
      body: scoped(() => import('@/apps/mail/components/Settings/FolderSettings.vue')),
      sections: [
        {
          id: 'your-folders',
          label: () => __('Your folders'),
          description: () => __('Rename, hide or delete your folders.'),
        },
      ],
    },
    {
      id: 'mail.import-export',
      label: () => __('Import and export'),
      icon: 'lucide-arrow-down-up',
      // Moving a whole mailbox in or out is work for a computer, not a phone.
      onPhone: false,
      // Import and export report their progress over the socket
      body: scoped(() => import('@/apps/mail/components/Settings/MailImportExportSettings.vue'), {
        socket: true,
      }),
      sections: [
        {
          id: 'import',
          label: () => __('Import'),
          description: () => __('Bring in mail or contacts from a file.'),
        },
        {
          id: 'export',
          label: () => __('Export'),
          description: () => __('Download a copy of your mail or contacts.'),
          keywords: () => __('download, backup'),
        },
      ],
    },
    {
      id: 'mail.advanced',
      label: () => __('Advanced'),
      icon: 'lucide-wrench',
      // Keys, servers and scripts are set up from a computer, not a phone.
      onPhone: false,
      body: scoped(() => import('@/apps/mail/components/Settings/MailAdvancedSettings.vue')),
      sections: [
        {
          id: 'rules',
          label: () => __('Rules'),
          description: () => __('Scripts that sort and file incoming mail for you.'),
          keywords: () => __('filters, sieve'),
        },
        {
          id: 'login-details',
          label: () => __('Login details'),
          description: () => __('The username and app password Mail connects with.'),
          keywords: () => __('username, app password'),
        },
        {
          id: 'client-setup',
          label: () => __('Mail client setup'),
          description: () => __('Server details for apps such as Thunderbird or the Gmail app.'),
          keywords: () => __('IMAP, SMTP, POP'),
        },
        { id: 'api-access', label: () => __('API access'), keywords: () => __('API key') },
        {
          id: 'push-subscriptions',
          label: () => __('Push subscriptions'),
          description: () => __('The devices and apps that are told when your mail changes.'),
          keywords: () => __('notifications, devices'),
        },
      ],
    },
  ],
} as const
