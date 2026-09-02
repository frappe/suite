import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { createResource, toast } from 'frappe-ui'

import { userStore } from '@/apps/calendar/stores/user'
import { isFirstOccurrence, scopeOptions } from '@/apps/calendar/utils/recurringScope'
import type { RecurringScope } from '@/apps/calendar/utils/recurringScope'
import type { ParticipantIdentity } from '@/apps/calendar/types/doctypes'

/** The part of a calendar event that deleting one reads. */
export interface DeletableEvent {
	/** The event's own id. A recurring instance carries the series id in `master_id`. */
	id?: string
	master_id?: string
	/** Set on an instance of a recurring series; absent on a one-off. */
	recurrence_id?: string
	/** The series' own start — the same date on its first occurrence, and only there. */
	master_start?: string
	recurrence_rule?: Record<string, unknown>
	/** The instance's own day — where "this and following" ends the series. */
	date?: string
	organizer?: string
	participants?: { email: string }[]
	/** A draft sent no invitations, so it never asks about a cancellation email. */
	isDraft?: boolean
}

/**
 * Deleting an event is the same act wherever it is offered — the detail
 * sidebar's ⋯ menu and the edit modal's — so both read it from here: the same
 * choices for a recurring event, the same cancellation email, the same toasts.
 *
 * @param getEvent - The event to delete. A getter, so the caller can hand over
 *   a prop it destructured, and so the menu follows the selection as it moves;
 *   it may return nothing while none is selected.
 * @param onDeleted - What the host does once the server confirms: reload the
 *   calendar, close itself.
 * @returns `deleteOption` for the host's own dropdown, `isDeleting` for the
 *   trigger's disabled state, the three pieces of the scope question a
 *   recurring event asks first (`showScopeModal`, `deleteScopeModalProps`,
 *   `deleteScope`), and the three of the cancellation-email prompt that follows
 *   it: `showNotifyModal`, `pendingDelete` and `NOTIFY_DELETE_OPTIONS`.
 */
export function useEventDelete(
	getEvent: () => DeletableEvent | undefined,
	onDeleted: () => void,
) {
	const store = userStore()
	const { participantIdentities } = store

	const calendarEvent = computed<DeletableEvent>(() => getEvent() ?? {})
	const eventId = computed(() => calendarEvent.value.master_id || calendarEvent.value.id)

	const deleteEventInstance = createResource({
		url: 'suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_event_instance',
		makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
			account: store.accountId,
			master_id: calendarEvent.value.master_id,
			recurrence_id: calendarEvent.value.recurrence_id,
			send_scheduling_messages: sendEmail,
		}),
		onSuccess: onDeleted,
	})

	const deleteEvent = createResource({
		url: 'suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events',
		makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
			account: store.accountId,
			ids: [eventId.value],
			send_scheduling_messages: sendEmail,
		}),
		onSuccess: onDeleted,
	})

	// "This and following" is an edit, not a delete: the series stops the day before.
	const editEvent = createResource({
		url: 'suite.calendar.api.edit_calendar_event',
		makeParams: ({ patch }: { patch: object }) => ({
			account: store.accountId,
			id: eventId.value,
			...patch,
			send_scheduling_messages: true,
		}),
		onSuccess: onDeleted,
	})

	const isDeleting = computed(
		() => deleteEventInstance.loading || deleteEvent.loading || editEvent.loading,
	)

	// When the organizer deletes an event with other participants, offer to email a
	// cancellation (mirrors the "Notify Participants" prompt shown when creating/editing).
	const isOrganizer = computed(
		() =>
			participantIdentities.data?.some(
				(id: ParticipantIdentity) =>
					id.email === (calendarEvent.value.organizer || '').replace('mailto:', ''),
			) ?? false,
	)
	const hasParticipantsOtherThanUser = computed(
		() =>
			calendarEvent.value.participants?.some((p) =>
				participantIdentities.data?.every((i: ParticipantIdentity) => i.email !== p.email),
			) ?? false,
	)

	const showNotifyModal = ref(false)
	const pendingDelete = ref<((sendEmail: boolean) => void) | null>(null)

	const confirmDelete = (submit: (sendEmail: boolean) => Promise<unknown>, recurring: boolean) => {
		const run = (sendEmail: boolean) => {
			showNotifyModal.value = false
			toast.promise(submit(sendEmail), {
				loading: recurring ? __('Deleting events...') : __('Deleting event...'),
				success: recurring ? __('Events deleted.') : __('Event deleted.'),
				error: __('Action failed. Please try again in some time.'),
			})
		}

		// A draft never sent its invitations, so there is no one to tell it is gone.
		if (isOrganizer.value && hasParticipantsOtherThanUser.value && !calendarEvent.value.isDraft) {
			pendingDelete.value = run
			showNotifyModal.value = true
		} else {
			run(false)
		}
	}

	const handleDeleteEventInstance = () =>
		confirmDelete((sendEmail) => deleteEventInstance.submit({ sendEmail }), false)

	const handleDeleteEvent = () =>
		confirmDelete(
			(sendEmail) => deleteEvent.submit({ sendEmail }),
			!!calendarEvent.value.recurrence_id,
		)

	const handleDeleteFollowingEventInstances = () => {
		const recurrenceRule = { ...calendarEvent.value.recurrence_rule }
		recurrenceRule.until = `${calendarEvent.value.date}T00:00:00Z`
		const patch = { recurrence_rule: JSON.stringify(recurrenceRule) }

		toast.promise(editEvent.submit({ patch }), {
			loading: __('Deleting events...'),
			success: __('Events deleted.'),
			error: __('Action failed. Please try again in some time.'),
		})
	}

	// How far the delete reaches used to be a submenu off the Delete item: three
	// commands hidden behind a hover, each firing the moment it was touched. It
	// is one question with three answers, so it is asked once, in the dialog
	// every other recurring action asks it in.
	const showScopeModal = ref(false)

	const requestDelete = () => {
		if (calendarEvent.value.recurrence_id) showScopeModal.value = true
		else handleDeleteEvent()
	}

	const deleteScopeModalProps = computed(() => ({
		title: __('Delete repeating event'),
		icon: { name: 'lucide-trash-2', theme: 'red' as const },
		// No line above the list: the title already says what is being deleted.
		options: scopeOptions({ isFirst: isFirstOccurrence(calendarEvent.value) }),
		confirmLabel: __('Delete'),
		theme: 'red' as const,
		loading: isDeleting.value,
	}))

	const deleteScope = (scope: RecurringScope) => {
		showScopeModal.value = false
		if (scope === 'instance') handleDeleteEventInstance()
		else if (scope === 'following') handleDeleteFollowingEventInstances()
		else handleDeleteEvent()
	}

	// The one entry a host drops into its own dropdown. A recurring event asks
	// which occurrences first; a one-off has nothing to ask.
	const deleteOption = computed(() => ({
		label: __('Delete'),
		icon: Trash2,
		onClick: requestDelete,
	}))

	const NOTIFY_DELETE_OPTIONS = {
		title: __('Notify Participants'),
		icon: { name: 'lucide-bell' },
		message: __('Send a cancellation email to let attendees know this event was deleted?'),
	}

	return {
		deleteOption,
		isDeleting,
		showScopeModal,
		deleteScopeModalProps,
		deleteScope,
		showNotifyModal,
		pendingDelete,
		NOTIFY_DELETE_OPTIONS,
	}
}
