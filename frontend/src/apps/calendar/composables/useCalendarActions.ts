import { ref } from 'vue'
import { Pencil, Pin, Share2, Trash2 } from 'lucide-vue-next'
import { createResource } from 'frappe-ui'

import { raiseToast, toastError } from '@/apps/calendar/utils'
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
	const showShare = ref(false)

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
		onError: toastError,
	})

	// Shown at once and saved behind: a toggle that waited on the server would feel broken,
	// and one that failed puts the calendar back as it was.
	const toggleVisible = (calendar: CalendarRow) => {
		const visible = calendar.visible ? 0 : 1
		calendar.visible = visible
		if (!calendar.may_write_all) {
			store.hiddenShared = visible
				? store.hiddenShared.filter((name) => name !== calendar.name)
				: [...store.hiddenShared, calendar.name]
			return
		}
		createResource({
			url: 'suite.calendar.api.edit_calendar',
			params: { account: calendar.account, id: calendar.id, visible: !!visible },
			auto: true,
			onError: (error) => {
				calendar.visible = visible ? 0 : 1
				toastError(error)
			},
		})
	}

	// Who a calendar is shared with is asked for on the way to the dialog, which opens once the
	// answer is in: a dialog that opened at once and filled in a moment later moved under the
	// reader's eyes, and there is nothing in it to look at before then.
	const sharing = createResource({
		url: 'suite.calendar.api.get_calendar_sharing',
		makeParams: (calendar: CalendarRow) => ({ account: calendar.account, id: calendar.id }),
		onSuccess: () => (showShare.value = true),
		onError: toastError,
	})

	const share = (calendar: CalendarRow) => {
		selected.value = calendar
		sharing.submit(calendar)
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
		// Who else sees it is the mail server's to say, so the option follows the right it reports
		// rather than whether the calendar is the user's to edit.
		{
			label: __('Share'),
			icon: Share2,
			condition: () => !!calendar.may_share,
			onClick: () => share(calendar),
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
		showShare,
		sharing,
		create,
		edit,
		canEdit,
		toggleVisible,
		menuOptions,
		hasMenuOptions,
	}
}
