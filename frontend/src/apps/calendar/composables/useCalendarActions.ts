import { ref } from 'vue'
import { Pencil, Pin, Trash2 } from 'lucide-vue-next'
import { createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/calendar/utils'
import { userStore } from '@/apps/calendar/stores/user'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'

/**
 * What can be done to a calendar, for the two places that list them: the sidebar
 * and the Calendars settings tab (the phone's only way in). The caller renders
 * CalendarModal on `showEdit` and DeleteCalendarModal on `showDelete`, both for
 * `selected`.
 */
export const useCalendarActions = () => {
	const store = userStore()

	const selected = ref<CalendarRow>()
	const showEdit = ref(false)
	const showDelete = ref(false)

	const makeDefault = createResource({
		url: 'suite.calendar.api.edit_calendar',
		makeParams: (calendar: CalendarRow) => ({
			account: store.accountId,
			id: calendar.id,
			default: true,
		}),
		onSuccess: () => {
			raiseToast(__('Default calendar changed.'))
			store.calendars.reload()
		},
		onError: (error) => raiseToast(error.messages?.[0] || error.message, 'error'),
	})

	const create = () => edit(undefined)

	const edit = (calendar?: CalendarRow) => {
		selected.value = calendar
		showEdit.value = true
	}

	const menuOptions = (calendar: CalendarRow) => [
		{
			label: __('Edit'),
			icon: Pencil,
			onClick: () => edit(calendar),
		},
		{
			label: __('Set as Default'),
			icon: Pin,
			condition: () => !calendar.default,
			onClick: () => makeDefault.submit(calendar),
		},
		// The default is where new events and invitations land, so it stays until another takes over.
		{
			label: __('Delete'),
			icon: Trash2,
			theme: 'red',
			condition: () => !calendar.default && !!calendar.may_delete,
			onClick: () => {
				selected.value = calendar
				showDelete.value = true
			},
		},
	]

	return { selected, showEdit, showDelete, create, edit, menuOptions }
}
