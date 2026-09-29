<template>
	<Dialog
		v-model:open="show"
		v-bind="{
			title: __('Delete {0}?', [calendar?._name]),
			message: __('Every event on this calendar will be deleted too. This can\'t be undone.'),
			icon: 'lucide-trash-2',
			theme: 'red',
			actions: [
				{
					label: __('Delete'),
					variant: 'solid',
					theme: 'red',
					loading: deleteCalendar.loading,
					onClick: () => deleteCalendar.submit(),
				},
			],
		}"
	/>
</template>

<script setup lang="ts">
import { Dialog, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/calendar/utils'
import { userStore } from '@/apps/calendar/stores/user'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'

const show = defineModel<boolean>()

const { calendar } = defineProps<{ calendar?: CalendarRow }>()

const store = userStore()

const deleteCalendar = createResource({
	url: 'suite.calendar.api.delete_calendar',
	makeParams: () => ({ account: calendar!.account, id: calendar!.id }),
	onSuccess: () => {
		raiseToast(__('Calendar deleted.'))
		show.value = false
		store.calendars.reload()
	},
	onError: (error) => raiseToast(error.messages?.[0] || error.message, 'error'),
})
</script>
