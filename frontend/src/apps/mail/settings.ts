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
    },
    {
      id: 'mail.sending',
      label: () => __('Sending'),
      icon: 'lucide-send',
      body: scoped(() => import('@/apps/mail/components/Settings/MailSendingSettings.vue')),
    },
    {
      id: 'mail.inbox',
      label: () => __('Inbox'),
      icon: 'lucide-inbox',
      body: scoped(() => import('@/apps/mail/components/Settings/MailInboxSettings.vue')),
    },
    {
      id: 'mail.advanced',
      label: () => __('Advanced'),
      icon: 'lucide-code',
      // Import and export report their progress over the socket
      body: scoped(() => import('@/apps/mail/components/Settings/MailAdvancedSettings.vue'), {
        socket: true,
      }),
    },
  ],
} as const
