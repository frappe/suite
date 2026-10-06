import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

import { api, useQuery, type OutputOf } from '@/api'
import { calendarColor } from '@/apps/calendar/utils/calendars'
import { useSession } from '@/platform/session'

type UserAccount = NonNullable<OutputOf<typeof api.mail.account.get>>['accounts'][number]
type ParticipantIdentity = OutputOf<typeof api.mail.participantIdentities.list>[number]
const ACCOUNT_STORAGE_KEY = 'mail-account-id'
export const userStore = defineStore('calendar-user', () => {
  const accountId = ref('')
  const resolveAccount = (accounts?: readonly UserAccount[], routeAccountId?: string) => {
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
            visible: hiddenShared.value.includes(cal.name) ? (0 as const) : (1 as const),
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
  return {
    accountId,
    resolveAccount,
    userResource,
    loadUser,
    identities,
    participantIdentities,
    calendars,
    hiddenShared,
    calendarOptions,
    accountCalendarOptions,
    organizerIdentity,
  }
})
