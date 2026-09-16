/**
 * The words an event's fields are chosen from, shared by the desktop form, its
 * alert list and the phone's form — so an event built on a phone is the same
 * object built with the same words as one built at a desk.
 */

export const VISIBILITY_OPTIONS = [
	{ label: __('Public'), value: 'Public' },
	{ label: __('Private'), value: 'Private' },
]

// Display is delivered as a device push and an in-app toast; Email is sent by
// the calendar server. `Audio` exists in the schema only so imported calendars
// keep their alarms — it plays nothing here, so it is not offered and an
// existing one reads as Display.
export const ALERT_ACTION_OPTIONS = [
	{ label: __('Notification'), value: 'Display' },
	{ label: __('Email'), value: 'Email' },
]

export const UNIT_OPTIONS = [
	{ label: __('Minutes'), value: 'minutes' },
	{ label: __('Hours'), value: 'hours' },
	{ label: __('Days'), value: 'days' },
	{ label: __('Weeks'), value: 'weeks' },
]

export const DIRECTION_OPTIONS = [
	{ label: __('Before'), value: -1 },
	{ label: __('After'), value: 1 },
]

export const RELATIVE_TO_OPTIONS = [
	{ label: __('Start'), value: 'Start' },
	{ label: __('End'), value: 'End' },
]
