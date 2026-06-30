<script setup lang="ts">
import { computed, h, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Eye, EyeOff, LayoutGrid, LogOut, Settings, User } from 'lucide-vue-next'
import { Avatar, Sidebar } from 'frappe-ui'

import { getAppSwitcherItems } from '@/apps/registry'
import { useSessionStore } from '@/boot/session'
import { toTitleCase } from '@/apps/calendar/utils/format'
import { brandingStore } from '@/apps/calendar/stores/branding'
import { userStore } from '@/apps/calendar/stores/user'
import CalendarLogo from '@/apps/calendar/components/Icons/CalendarLogo.vue'
import SettingsModal from '@/apps/calendar/components/Modals/SettingsModal.vue'

const { calendars, visibleCalendars } = defineProps<{
	calendars: any[]
	visibleCalendars: string[]
}>()

const emit = defineEmits(['update:visibleCalendars'])

const route = useRoute()
const router = useRouter()
const { branding } = brandingStore()
const { logout } = useSessionStore()
const store = userStore()

const user = inject('$user')

const title = computed(() =>
	branding.data?.brand_name && branding.data?.brand_name != 'Frappe'
		? branding.data.brand_name
		: 'Calendar',
)

const subtitle = computed(() => {
	const currentAccount = user.data.accounts.find((a) => a.id === store.accountId)
	if (currentAccount.is_personal) return toTitleCase(user.data.full_name)
	return currentAccount._name
})

const apps = { get data() { return getAppSwitcherItems('calendar') } }

const showSettings = ref(false)

const menuItems = computed(() => [
	{
		group: '',
		items: [
			{
				icon: LayoutGrid,
				label: __('Apps'),
				submenu: apps.data?.map?.((app) => ({
					component: h(
						'a',
						{
							class: 'flex items-center gap-2 p-1.5 rounded hover:bg-surface-gray-2',
							href: app.route,
						},
						[
							h('img', { src: app.logo, class: 'size-6' }),
							h('span', { class: 'max-w-18 text-sm w-full truncate' }, app.title),
						],
					),
				})),
			},
		],
	},
	{
		group: '',
		items: [
			{
				icon: Settings,
				label: __('Settings'),
				onClick: () => (showSettings.value = true),
			},
		],
	},
	{
		group: '',
		items: [
			{
				icon: User,
				label: __('Accounts'),
				submenu: user.data.accounts.map?.((a) => ({
					component: h(
						'div',
						{
							class: 'flex items-center gap-2 p-1.5 rounded hover:bg-surface-gray-2 cursor-pointer w-48 shrink-0',
							onClick: () =>
								router.push({
									name: route.name,
									params: { ...route.params, accountId: a.id },
								}),
						},
						[
							h(Avatar, { label: a._name, size: 'md' }),
							h('span', { class: 'text-sm w-full truncate' }, a._name),
							a.id === store.accountId &&
								h(Check, { label: a._name, class: 'h-4 shrink-0 stroke-1.5' }),
						],
					),
				})),
				condition: () => user.data.accounts?.length > 1,
			},
			{
				icon: LogOut,
				label: __('Log Out'),
				onClick: logout.submit,
			},
		],
	},
])

const sidebarItems = computed(() => [
	{
		label: __('Calendars'),
		items:
			calendars.map((calendar) => ({
				label: calendar._name,
				icon: visibleCalendars.includes(calendar.name) ? Eye : EyeOff,
				onClick: () => emit('update:visibleCalendars', calendar.name),
			})) || [],
	},
])
</script>

<template>
	<Sidebar
		:header="{
			title,
			subtitle,
			menuItems,
			logo: branding.data?.brand_html || CalendarLogo,
		}"
		:sections="sidebarItems"
		:disable-collapse="true"
	/>
	<SettingsModal v-model="showSettings" />
</template>
