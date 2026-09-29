import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { createResource } from 'frappe-ui'

import type { ParticipantIdentity, UserAccount } from '@/apps/calendar/types/doctypes'
import { calendarColor } from '@/apps/calendar/utils/calendars'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

const ACCOUNT_STORAGE_KEY = 'mail-account-id'

export const userStore = defineStore('calendar-user', () => {
	const accountId = ref('')

	const resolveAccount = (accounts?: UserAccount[], routeAccountId?: string) => {
		if (!accounts?.length) return

		// 1. Route param
		if (routeAccountId && accounts.some((a) => a.id === routeAccountId)) {
			if (routeAccountId !== accountId.value) setAccount(routeAccountId)
			return
		}

		// 2. localStorage
		const localId = localStorage.getItem(ACCOUNT_STORAGE_KEY)
		if (localId && accounts.some((a) => a.id === localId)) {
			if (localId !== accountId.value) setAccount(localId)
			return
		}

		// 3. Personal account fallback
		if (accountId.value) return
		const personalId = accounts.find((a) => a.is_personal)?.id
		if (personalId) setAccount(personalId)
	}

	const setAccount = (id: string) => {
		accountId.value = id
		localStorage.setItem(ACCOUNT_STORAGE_KEY, id)
		identities.fetch()
		participantIdentities.fetch()
		calendars.fetch()
	}

	const userResource = createResource({
		url: 'suite.mail.api.account.get_user_info',
		// Only the accounts with a calendar the user can write to: one that only shares calendars
		// with them is under Shared Calendars, not an account to switch to. All of them stay in
		// `all_accounts`, to name where a shared calendar is from. In place, so onSuccess — handed
		// the response rather than this — reads the same list.
		transform: (data) => {
			if (data?.accounts) {
				data.all_accounts = data.accounts
				data.accounts = data.accounts.filter((account) => account.in_calendar)
			}
			return data
		},
		onSuccess: (data) => resolveAccount(data?.accounts),
		onError: (error) => {
			if (error && error.exc_type === 'AuthenticationError')
				window.location.replace('/login?redirect-to=/calendar')
		},
		auto: true,
	})

	// The account's mail identities: the addresses it can send from.
	const identities = createResource({
		url: 'suite.mail.api.account.get_identities',
		makeParams: () => ({ account: accountId.value }),
		cache: ['identities', accountId.value],
	})

	const participantIdentities = createResource({
		url: 'suite.mail.api.account.get_participant_identities',
		makeParams: () => ({ account: accountId.value }),
		cache: ['participantIdentities', accountId.value],
	})

	// The account's calendars, and those shared with the user from other accounts. One list
	// for the grid, the sidebar, the event form and settings, so a calendar added or renamed
	// in one is there in the others.
	const calendars = createResource<CalendarRow[]>({
		url: 'suite.calendar.api.get_calendars_with_shared',
		makeParams: () => ({ account: accountId.value }),
		cache: ['calendars', accountId.value],
		transform: (rows: CalendarRow[]) =>
			rows.map((cal) =>
				cal.may_write_all ? cal : { ...cal, visible: hiddenShared.value.includes(cal.name) ? 0 : 1 },
			),
	})

	// Showing or hiding a calendar is its own `isVisible`, which the mail server only lets
	// someone who can write to it change — so a calendar shared read-only is hidden in this
	// browser instead.
	const hiddenShared = useStorage<string[]>('calendar-hidden-shared', [])

	// The calendars as select options, keyed by `account|id`, each in the colour it is drawn in.
	// A calendar shared from another account names that account beneath.
	const calendarOptions = computed(() => {
		const accounts: UserAccount[] = userResource.data?.all_accounts ?? []
		return (calendars.data ?? []).map((cal) => ({
			label: cal._name,
			description:
				cal.account === accountId.value
					? undefined
					: accounts.find((a) => a.id === cal.account)?._name,
			value: cal.name,
			account: cal.account,
			color: calendarColor(calendars.data, cal.name),
			writable: !!cal.may_write_all,
		}))
	})

	// One account's calendars, keyed by their bare id, for what works on a single account:
	// import and export.
	const accountCalendarOptions = (account: string) =>
		calendarOptions.value
			.filter((option) => option.account === account)
			.map((option) => ({ ...option, value: option.value.split('|')[1] }))

	// The organizer of a new event. Invites go out as mail from the organizer's address,
	// so only a participant identity that is also a mail identity qualifies. Among those
	// the one flagged default wins, else the first. Undefined until both lists have
	// loaded, or when no address is on both.
	const organizerIdentity = computed<ParticipantIdentity | undefined>(() => {
		const sendable = new Set<string>((identities.data ?? []).map((i: { email: string }) => i.email))
		const candidates: ParticipantIdentity[] = (participantIdentities.data ?? []).filter((i) =>
			sendable.has(i.email),
		)
		return candidates.find((i) => i.default) ?? candidates[0]
	})

	return {
		accountId,
		resolveAccount,
		userResource,
		identities,
		participantIdentities,
		calendars,
		hiddenShared,
		calendarOptions,
		accountCalendarOptions,
		organizerIdentity,
	}
})
