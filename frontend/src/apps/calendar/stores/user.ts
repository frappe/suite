import { until, useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import { api, useQuery, type OutputOf } from '@/api'
import {
  calendarColor,
  carriedVisibility,
  type SharedVisibility,
} from '@/apps/calendar/utils/calendars'
import { useSession } from '@/platform/session'

type UserAccount = NonNullable<OutputOf<typeof api.mail.account.get>>['accounts'][number]
type ParticipantIdentity = OutputOf<typeof api.mail.participantIdentities.list>[number]
const ACCOUNT_STORAGE_KEY = 'mail-account-id'
// How long a form opened outside Calendar waits for what it reads before it opens on what has come.
const FORM_LOAD_WAIT_MS = 10_000
export const userStore = defineStore('calendar-user', () => {
  const accountId = ref('')
  const preferredAccountId = () => localStorage.getItem(ACCOUNT_STORAGE_KEY)
  const resolveAccount = (accounts?: readonly UserAccount[], routeAccountId?: string) => {
    if (!accounts?.length) return

    // 1. Route param
    if (routeAccountId && accounts.some((a) => a.id === routeAccountId)) {
      if (routeAccountId !== accountId.value) setAccount(routeAccountId)
      return
    }

    // 2. localStorage
    const localId = preferredAccountId()
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
  }
  const account = () =>
    accountId.value
      ? {
          account: accountId.value,
        }
      : false
  const userQuery = useQuery(api.mail.account.get, () => (useSession().user.value ? {} : false))
  const userData = computed(() => {
    const data = userQuery.data
    return data
      ? {
          ...data,
          all_accounts: data.accounts,
          accounts: data.accounts.filter((account) => account.in_calendar),
        }
      : data
  })
  const userResource = reactive({
    get data() {
      return userData.value
    },
    refetch: userQuery.refetch,
  })
  const loadUser = () => userQuery.refetch()
  watch(
    () => userData.value?.accounts,
    (accounts) => resolveAccount(accounts),
    {
      flush: 'sync',
    },
  )
  watch(
    () => userQuery.error,
    (error) => {
      if (error && 'type' in error && error.type === 'AuthenticationError')
        window.location.replace('/login?redirect-to=/calendar')
    },
  )
  const identities = useQuery(api.mail.identities.list, account)
  const participantIdentities = useQuery(api.mail.participantIdentities.list, account)
  const calendarQuery = useQuery(api.calendar.calendars.list, account)
  const calendarData = computed(() =>
    calendarQuery.data?.map((cal) =>
      cal.may_write_all
        ? cal
        : {
            ...cal,
            // Drawn once the reader ticks it: a shared calendar starts unticked.
            visible: sharedVisibility.value[cal.name] ?? 0,
          },
    ),
  )
  const calendars = reactive({
    get data() {
      return calendarData.value
    },
    refetch: calendarQuery.refetch,
    get isFetching() {
      return calendarQuery.isFetching
    },
    get error() {
      return calendarQuery.error
    },
  })

  // Showing or hiding a calendar is its own `isVisible`, which the mail server only lets
  // someone who can write to it change — so a calendar shared read-only is shown or hidden in
  // this browser instead. Kept only where the reader made a choice; the rest stay unticked.
  const sharedVisibility = useStorage<SharedVisibility>('calendar-shared-visibility', {})

  // An earlier build kept the hidden ones as a list. It is folded in with the first calendar
  // list that arrives, before anything is drawn, so nobody's shared calendars vanish.
  const LEGACY_HIDDEN_KEY = 'calendar-hidden-shared'
  watch(
    () => calendarQuery.data,
    (rows) => {
      const legacy = localStorage.getItem(LEGACY_HIDDEN_KEY)
      if (!rows || legacy === null) return
      try {
        sharedVisibility.value = carriedVisibility(rows, JSON.parse(legacy), sharedVisibility.value)
      } catch {
        // nothing readable under the old key, so nothing to carry
      }
      localStorage.removeItem(LEGACY_HIDDEN_KEY)
    },
    { flush: 'sync', immediate: true },
  )

  // The calendars as select options, keyed by `account|id`, each in the colour it is drawn in.
  // A calendar shared from another account names that account beneath.
  const calendarOptions = computed(() => {
    const accounts: UserAccount[] = userResource.data?.all_accounts ?? []
    return (calendars.data ?? []).map((cal) => ({
      label: cal._name,
      description:
        cal.account === accountId.value
          ? undefined
          : (accounts.find((a) => a.id === cal.account)?._name ?? undefined),
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
      .map((option) => ({
        ...option,
        value: option.value.split('|')[1],
      }))

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

  // What the event form reads, loaded for a form opened outside Calendar, where no route guard has
  // asked for any of it: the account, then its identities and calendars. Resolves once each has
  // answered, loaded or not, or has taken too long to wait for.
  const loadForEventForm = async () => {
    if (userQuery.data === undefined) await loadUser().catch(() => undefined)
    resolveAccount(userData.value?.accounts)
    if (!accountId.value) return
    await Promise.all(
      [identities, participantIdentities, calendarQuery].map((query) =>
        until(() => query.status).not.toBe('pending', { timeout: FORM_LOAD_WAIT_MS }),
      ),
    )
  }
  return {
    accountId,
    preferredAccountId,
    resolveAccount,
    userResource,
    loadUser,
    loadForEventForm,
    identities,
    participantIdentities,
    calendars,
    sharedVisibility,
    calendarOptions,
    accountCalendarOptions,
    organizerIdentity,
  }
})
