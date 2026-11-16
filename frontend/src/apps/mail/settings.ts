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
  condition: () => useSession().capabilities.value.jmap,
  tabs: [
    {
      id: 'mail.general',
      label: () => __('General'),
      icon: 'lucide-mailbox',
      body: scoped(() => import('@/apps/mail/components/Settings/GeneralSettings.vue')),
    },
    {
      id: 'mail.identities',
      label: () => __('Identities & signatures'),
      icon: 'lucide-fingerprint',
      body: scoped(() => import('@/apps/mail/components/Settings/IdentitySettings.vue')),
    },
    {
      id: 'mail.folders',
      label: () => __('Folders'),
      icon: 'lucide-folders',
      body: scoped(() => import('@/apps/mail/components/Settings/FolderSettings.vue')),
    },
    {
      id: 'mail.screener',
      label: () => __('Screener'),
      icon: 'lucide-eye',
      body: scoped(() => import('@/apps/mail/components/Settings/ScreenerSettings.vue')),
    },
    {
      id: 'mail.vacation',
      label: () => __('Vacation response'),
      icon: 'lucide-tree-palm',
      body: scoped(() => import('@/apps/mail/components/Settings/VacationResponseSettings.vue')),
    },
    {
      id: 'mail.transfer',
      label: () => __('Import & export'),
      icon: 'lucide-arrow-down-up',
      body: scoped(() => import('@/apps/mail/components/Settings/TransferSettings.vue'), {
        socket: true,
      }),
    },
    {
      id: 'mail.advanced',
      label: () => __('Advanced'),
      icon: 'lucide-code',
      body: scoped(() => import('@/apps/mail/components/Settings/AdvancedSettings.vue')),
    },
  ],
} as const
