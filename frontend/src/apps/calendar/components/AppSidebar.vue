<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Eye, EyeOff, LogOut, Settings, User } from 'lucide-vue-next'
import { Sidebar, SidebarCollapseToggle, SidebarHeader, SidebarItem, SidebarSection } from 'frappe-ui'
import { useStorage } from '@vueuse/core'

import { useSessionStore } from '@/boot/session'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
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

const appsMenuOption = useAppSwitcher('calendar')

const showSettings = ref(false)
const isSidebarCollapsed = useStorage('isSidebarCollapsed', false)

const menuItems = computed(() => [
	{
		group: '',
		options: [appsMenuOption.value],
	},
	{
		group: '',
		options: [
			{
				icon: Settings,
				label: __('Settings'),
				onClick: () => (showSettings.value = true),
			},
		],
	},
	{
		group: '',
		options: [
			{
				icon: User,
				label: __('Accounts'),
				submenu: user.data.accounts.map?.((a) => ({
					label: a._name,
					selected: a.id === store.accountId,
					onClick: () => router.push({ name: route.name, params: { ...route.params, accountId: a.id } }),
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
	<Sidebar v-model:collapsed="isSidebarCollapsed">
		<SidebarHeader :title="title" :subtitle="subtitle" :menu-items="menuItems" :logo="branding.data?.brand_html || CalendarLogo" />
		<div class="flex-1 px-2">
			<SidebarSection v-for="section in sidebarItems" :key="section.label" :label="section.label">
				<SidebarItem v-for="item in section.items" :key="item.label" :label="item.label" :icon="item.icon" :on-click="item.onClick" />
			</SidebarSection>
		</div>
		<div class="p-2"><SidebarCollapseToggle /></div>
	</Sidebar>
	<SettingsModal v-model="showSettings" />
</template>
