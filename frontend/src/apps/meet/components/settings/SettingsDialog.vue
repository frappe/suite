<template>
	<SuiteSettingsDialog
		v-model:open="open"
		v-model:tab="activeTab"
		:groups="groups"
		:include-common="false"
	/>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import {
	AudioLines,
	Bell,
	Camera,
	LayoutDashboard,
	MonitorSmartphone,
	User,
} from 'lucide-vue-next'
import { useDoc } from 'frappe-ui'

import { session } from '@/boot/session'
import type { SettingsGroup } from '@/components/settings/types'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'
import AudioSettingsTab from './AudioSettingsTab.vue'
import BackgroundSettingsTab from './BackgroundSettingsTab.vue'
import DeviceSettingsTab from './DeviceSettingsTab.vue'
import LayoutSettingsTab from './LayoutSettingsTab.vue'
import MeetingAccessSettingsTab from './MeetingAccessSettingsTab.vue'
import NotificationSettingsTab from './NotificationSettingsTab.vue'

const props = defineProps<{
	meetingId?: string
	isPreview?: boolean
}>()

const emit = defineEmits<{
	'device-changed': [event: unknown]
}>()

const open = defineModel<boolean>('open', { default: false })
const activeTab = ref('devices')

const meetingDoc = useDoc<{
	name: string
	owner?: string
	co_hosts?: { user: string }[]
}>({
	doctype: 'Meet Room',
	name: () => props.meetingId || '',
})

const canManageMeeting = computed(
	() =>
		!props.isPreview &&
		(meetingDoc.doc?.owner === session.user?.sessionUser ||
			meetingDoc.doc?.co_hosts?.some((row) => row.user === session.user?.sessionUser)),
)

const groups = computed<SettingsGroup[]>(() => {
	const panelProps = (value: string) => ({
		isVisible: open.value && activeTab.value === value,
		meetingId: props.meetingId,
	})
	const deviceListener = { 'device-changed': (event: unknown) => emit('device-changed', event) }

	return [
		{
			id: 'meet-controls',
			label: 'Meeting',
			condition: () => Boolean(canManageMeeting.value),
			items: [
				{
					label: 'Controls',
					value: 'meeting-access',
					icon: User,
					component: markRaw(MeetingAccessSettingsTab),
					props: panelProps('meeting-access'),
				},
			],
		},
		{
			id: 'meet-media',
			label: 'Media',
			items: [
				{
					label: 'Devices',
					value: 'devices',
					icon: MonitorSmartphone,
					component: markRaw(DeviceSettingsTab),
					props: panelProps('devices'),
					listeners: deviceListener,
				},
				{
					label: 'Audio',
					value: 'audio',
					icon: AudioLines,
					component: markRaw(AudioSettingsTab),
					props: panelProps('audio'),
					listeners: deviceListener,
				},
				{
					label: 'Video',
					value: 'background',
					icon: Camera,
					component: markRaw(BackgroundSettingsTab),
					props: panelProps('background'),
					listeners: deviceListener,
				},
			],
		},
		{
			id: 'meet-interface',
			label: 'Interface',
			items: [
				{
					label: 'Notifications',
					value: 'notifications',
					icon: Bell,
					component: markRaw(NotificationSettingsTab),
					props: panelProps('notifications'),
				},
				{
					label: 'Layout',
					value: 'layout',
					icon: LayoutDashboard,
					component: markRaw(LayoutSettingsTab),
					condition: () => !props.isPreview,
					props: panelProps('layout'),
				},
			],
		},
	]
})
</script>
