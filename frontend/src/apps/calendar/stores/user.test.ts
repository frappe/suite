import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import { userStore } from '@/apps/calendar/stores/user'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

// What the server answers the calendar list with. Nothing else is asked of it here.
const server = vi.hoisted(() => {
  const calendars: CalendarRow[] = []
  return { calendars }
})

// The store only needs `data` and `fetch` from a resource; nothing fires on its own.
vi.mock('@/api', async (original) => {
  const actual = await original<typeof import('@/api')>()
  return {
    ...actual,
    useQuery: (query: unknown) =>
      reactive({
        data: query === actual.api.calendar.calendars.list ? server.calendars : undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
      }),
  }
})

const participant = (email: string, isDefault: 0 | 1 = 0) => ({
  name: `acc|${email}`,
  id: email,
  _name: email.split('@')[0],
  email,
  default: isDefault,
  account: 'acc',
})
const identity = (email: string) => ({ name: `acc|${email}`, id: email, email })

const storeWith = (participants?: object[], identities?: object[]) => {
  const store = userStore()
  store.participantIdentities.data = participants
  store.identities.data = identities
  return store
}

describe('organizerIdentity', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is undefined until both lists load', () => {
    expect(storeWith(undefined, undefined).organizerIdentity).toBeUndefined()
    expect(storeWith([participant('a@x.io')], undefined).organizerIdentity).toBeUndefined()
    expect(storeWith(undefined, [identity('a@x.io')]).organizerIdentity).toBeUndefined()
  })

  it('is undefined when no address is both a mail and a participant identity', () => {
    expect(storeWith([], []).organizerIdentity).toBeUndefined()
    expect(
      storeWith([participant('a@x.io')], [identity('b@x.io')]).organizerIdentity,
    ).toBeUndefined()
  })

  it('prefers the participant identity flagged default when it can send', () => {
    const store = storeWith(
      [participant('a@x.io'), participant('b@x.io', 1)],
      [identity('a@x.io'), identity('b@x.io')],
    )
    expect(store.organizerIdentity?.email).toBe('b@x.io')
  })

  it('skips a default that has no mail identity', () => {
    const store = storeWith([participant('a@x.io'), participant('b@x.io', 1)], [identity('a@x.io')])
    expect(store.organizerIdentity?.email).toBe('a@x.io')
  })

  it('falls back to the first common identity when none is flagged', () => {
    const store = storeWith(
      [participant('c@x.io'), participant('a@x.io'), participant('b@x.io')],
      [identity('b@x.io'), identity('a@x.io')],
    )
    expect(store.organizerIdentity?.email).toBe('a@x.io')
  })
})

describe('which calendars are drawn', () => {
  const row = (name: string, extra: Partial<CalendarRow> = {}): CalendarRow => ({
    name: `acc|${name}`,
    account: 'acc',
    id: name,
    _name: name,
    default: 0,
    visible: 1,
    may_write_all: 0,
    may_delete: 0,
    ...extra,
  })
  const mine = row('mine', { may_write_all: 1, may_delete: 1 })
  const team = row('team')
  const holidays = row('h1', { name: 'external|h1', account: 'external' })

  const drawn = () =>
    Object.fromEntries((userStore().calendars.data ?? []).map((cal) => [cal.name, cal.visible]))

  beforeEach(() => {
    localStorage.clear()
    server.calendars.splice(0, Infinity, mine, team, holidays)
    setActivePinia(createPinia())
  })

  it("starts shared calendars unticked, the site's own among them, and the reader's own as the server says", () => {
    expect(drawn()).toEqual({ 'acc|mine': 1, 'acc|team': 0, 'external|h1': 0 })
  })

  it('draws a shared calendar once the reader ticks it', () => {
    userStore().sharedVisibility = { 'external|h1': 1 }
    expect(drawn()).toEqual({ 'acc|mine': 1, 'acc|team': 0, 'external|h1': 1 })
  })

  it('keeps drawn the shared calendars an earlier build was drawing', () => {
    localStorage.setItem('calendar-hidden-shared', JSON.stringify([]))
    expect(drawn()).toEqual({ 'acc|mine': 1, 'acc|team': 1, 'external|h1': 0 })
  })
})
