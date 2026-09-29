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

// The layout choice is a desktop one: a phone shows one pane at a time.
const isDesktop = () => !window.matchMedia('(max-width: 767px)').matches

export const mailSettings = {
	label: () => __('Mail'),
	condition: () => useSession().capabilities.value.jmap,
	tabs: [
		{
			id: 'mail.credentials',
			label: () => __('Credentials'),
			icon: 'lucide-key-round',
			body: scoped(() => import('@/apps/mail/components/Settings/CredentialsSettings.vue')),
		},
		{
			id: 'mail.account',
			label: () => __('Account'),
			icon: 'lucide-mailbox',
			body: scoped(() => import('@/apps/mail/components/Settings/Account.vue')),
		},
		{
			id: 'mail.identity',
			label: () => __('Identity'),
			icon: 'lucide-fingerprint',
			body: scoped(() => import('@/apps/mail/components/Settings/IdentitySettings.vue')),
		},
		{
			id: 'mail.layout',
			label: () => __('Layout'),
			icon: 'lucide-columns-2',
			condition: isDesktop,
			body: scoped(() => import('@/apps/mail/components/Settings/MailLayoutSettings.vue')),
		},
		{
			id: 'mail.folders',
			label: () => __('Folders'),
			icon: 'lucide-folders',
			body: scoped(() => import('@/apps/mail/components/Settings/FolderSettings.vue')),
		},
		{
			id: 'mail.signatures',
			label: () => __('Signatures'),
			icon: 'lucide-feather',
			body: scoped(() => import('@/apps/mail/components/Settings/SignatureSettings.vue')),
		},
		{
			id: 'mail.compose',
			label: () => __('Compose'),
			icon: 'lucide-pen-line',
			body: scoped(() => import('@/apps/mail/components/Settings/ComposeSettings.vue')),
		},
		{
			id: 'mail.vacation-response',
			label: () => __('Vacation Response'),
			icon: 'lucide-tree-palm',
			body: scoped(() => import('@/apps/mail/components/Settings/VacationResponseSettings.vue')),
		},
		{
			id: 'mail.automation',
			label: () => __('Automation'),
			icon: 'lucide-zap',
			body: scoped(() => import('@/apps/mail/components/Settings/AutomationSettings.vue')),
		},
		{
			id: 'mail.push-subscriptions',
			label: () => __('Push Subscriptions'),
			icon: 'lucide-bell-ring',
			body: scoped(() => import('@/apps/mail/components/Settings/PushSubscriptionSettings.vue')),
		},
		{
			id: 'mail.screener',
			label: () => __('Screener'),
			icon: 'lucide-eye',
			body: scoped(() => import('@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue')),
		},
		{
			id: 'mail.import',
			label: () => __('Import'),
			icon: 'lucide-hard-drive-download',
			body: scoped(() => import('@/apps/mail/components/Settings/ImportSettings.vue'), { socket: true }),
		},
		{
			id: 'mail.export',
			label: () => __('Export'),
			icon: 'lucide-hard-drive-upload',
			body: scoped(() => import('@/apps/mail/components/Settings/ExportSettings.vue'), { socket: true }),
		},
		{
			id: 'mail.advanced',
			label: () => __('Advanced'),
			icon: 'lucide-code',
			body: scoped(() => import('@/apps/mail/components/Settings/AdvancedSettings.vue')),
		},
	],
} as const
