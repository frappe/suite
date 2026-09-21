import { ref } from 'vue'
import { Eye, EyeOff, Pencil, Pin, Trash2 } from 'lucide-vue-next'
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
			account: calendar.account,
			id: calendar.id,
			default: true,
		}),
		onSuccess: () => {
			raiseToast(__('Default calendar changed.'))
			store.calendars.reload()
		},
		onError: (error) => raiseToast(error.messages?.[0] || error.message, 'error'),
	})

	// Shown at once and saved behind: a toggle that waited on the server would feel broken,
	// and one that failed puts the calendar back as it was.
	const toggleVisible = (calendar: CalendarRow) => {
		const visible = calendar.visible ? 0 : 1
		calendar.visible = visible
		if (!calendar.may_write_all) {
			// Each list holds the choices made against a default: hidden, for a calendar that
			// starts shown; shown, for one that starts hidden.
			const list = calendar.default_hidden ? 'shownShared' : 'hiddenShared'
			const listed = calendar.default_hidden ? !!visible : !visible
			const others = store[list].filter((name) => name !== calendar.name)
			store[list] = listed ? [...others, calendar.name] : others
			return
		}
		createResource({
			url: 'suite.calendar.api.edit_calendar',
			params: { account: calendar.account, id: calendar.id, visible: !!visible },
			auto: true,
			onError: (error) => {
				calendar.visible = visible ? 0 : 1
				raiseToast(error.messages?.[0] || error.message, 'error')
			},
		})
	}

	const create = () => edit(undefined)

	const edit = (calendar?: CalendarRow) => {
		selected.value = calendar
		showEdit.value = true
	}

	// A calendar shared read-only can't be renamed or recoloured, and is no place for new
	// events and invitations to land.
	const canEdit = (calendar: CalendarRow) => !!calendar.may_write_all

	const menuOptions = (calendar: CalendarRow) => [
		// The sidebar's row does this on a click, and the phone has no sidebar: there, this is
		// the only way to show a calendar that starts out hidden, or to hide one.
		{
			label: calendar.visible ? __('Hide') : __('Show'),
			icon: calendar.visible ? EyeOff : Eye,
			onClick: () => toggleVisible(calendar),
		},
		{
			label: __('Edit'),
			icon: Pencil,
			condition: () => canEdit(calendar),
			onClick: () => edit(calendar),
		},
		{
			label: __('Set as Default'),
			icon: Pin,
			condition: () => canEdit(calendar) && !calendar.default,
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

	// With nothing to offer, the options button is left out rather than opening an empty menu.
	const hasMenuOptions = (calendar: CalendarRow) =>
		menuOptions(calendar).some((option) => !option.condition || option.condition())

	return {
		selected,
		showEdit,
		showDelete,
		create,
		edit,
		canEdit,
		toggleVisible,
		menuOptions,
		hasMenuOptions,
	}
}
