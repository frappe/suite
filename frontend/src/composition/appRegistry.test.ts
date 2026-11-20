import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import {
  areaDefinitions,
  deriveAreaBadges,
  findArea,
  useAppRegistry,
} from '@/composition/appRegistry'
import type { Session } from '@/platform/session'

const registryState = vi.hoisted(() => ({
  inbox: { data: { unread: 7, accounts: [{ name: 'me', unread: 7, personal: true }] } },
  upcoming: { data: { upcoming: 2 } },
}))

vi.mock('@/apps/drive', () => ({
  filesArea: {
    id: 'files',
    label: () => 'files',
    icon: {},
    to: '/drive',
    loadRoutes: vi.fn(),
  },
}))

vi.mock('@/apps/mail', () => ({
  mailArea: {
    id: 'mail',
    label: () => 'mail',
    icon: {},
    to: '/mail',
    requires: ['jmap'],
    loadRoutes: vi.fn(),
  },
  useInboxSummary: () => registryState.inbox,
}))

vi.mock('@/apps/calendar', () => ({
  calendarArea: {
    id: 'calendar',
    label: () => 'calendar',
    icon: {},
    to: '/calendar',
    requires: ['jmap'],
    loadRoutes: vi.fn(),
  },
  useUpcomingSummary: () => registryState.upcoming,
}))

vi.mock('@/apps/people', () => ({
  peopleArea: {
    id: 'people',
    label: () => 'people',
    icon: {},
    to: '/people',
    requires: ['jmap'],
    loadRoutes: vi.fn(),
  },
}))

vi.mock('@/apps/meet', () => ({
  meetArea: {
    id: 'meet',
    label: () => 'meet',
    icon: {},
    to: '/meet',
    loadRoutes: vi.fn(),
  },
}))

describe('app registry', () => {
  it('keeps the agreed area order', () => {
    expect(areaDefinitions.map((area) => area.id)).toEqual([
      'home',
      'files',
      'mail',
      'calendar',
      'meet',
      'people',
      'admin',
    ])
  })

  it('lists only areas whose capabilities are present and updates when they change', () => {
    const capabilities = ref({ jmap: false, systemManager: false, suiteAdmin: false })
    const session = fromPartial<Session>({ capabilities })
    const registry = useAppRegistry(session)

    expect(findArea('mail')?.to).toBe('/mail')
    expect(findArea('calendar')?.to).toBe('/calendar')
    expect(registry.areas.map((area) => area.id)).toEqual(['home', 'files', 'meet'])
    capabilities.value.jmap = true
    expect(registry.areas.map((area) => area.id)).toEqual([
      'home',
      'files',
      'mail',
      'calendar',
      'meet',
      'people',
    ])
    capabilities.value.jmap = false
    expect(registry.areas.map((area) => area.id)).toEqual(['home', 'files', 'meet'])
  })

  it('shows Admin only to a Suite Admin, not a System Manager alone', () => {
    const capabilities = ref({ jmap: false, systemManager: true, suiteAdmin: false })
    const session = fromPartial<Session>({
      capabilities,
    })
    const registry = useAppRegistry(session)
    expect(registry.areas.some((area) => area.id === 'admin')).toBe(false)
    capabilities.value = { jmap: false, systemManager: false, suiteAdmin: true }
    expect(registry.areas.some((area) => area.id === 'admin')).toBe(true)
  })

  const account = (name: string, unread: number, personal = false) => ({ name, unread, personal })
  const inbox = (...accounts: ReturnType<typeof account>[]) => ({
    unread: accounts.reduce((sum, a) => sum + a.unread, 0),
    accounts,
  })

  it('counts every account in the Mail badge', () => {
    expect(deriveAreaBadges(inbox(account('me', 4, true), account('team', 3))).mail.count).toBe(7)
    expect(deriveAreaBadges(undefined).mail.count).toBe(0)
    expect(deriveAreaBadges({ unread: -1, accounts: [] }).mail.count).toBe(0)
  })

  // Mail in the reader's own account asks for them. Mail only in the accounts they share with
  // others is there to be seen, without the alarm.
  it("quiets the Mail badge only while none of the unread mail is the reader's own", () => {
    const quiet = (own: number) =>
      deriveAreaBadges(inbox(account('me', own, true), account('team', 6))).mail.quiet
    expect(quiet(1)).toBe(false)
    expect(quiet(0)).toBe(true)
  })

  // With one account there is nowhere else the mail could be: the count says it all.
  it('names each account with unread mail, when there is more than one', () => {
    const me = account('me@example.com', 5, true)
    expect(
      deriveAreaBadges(inbox(me, account('dev@example.com', 0), account('team@example.com', 3)))
        .mail.parts,
    ).toEqual([
      { label: 'me@example.com', count: 5 },
      { label: 'team@example.com', count: 3 },
    ])
    expect(deriveAreaBadges(inbox(me)).mail.parts).toBeUndefined()
  })

  it('derives the Calendar badge from what is left of the day', () => {
    expect(deriveAreaBadges(undefined, { upcoming: 3 }).calendar).toEqual({
      count: 3,
      quiet: false,
    })
    expect(deriveAreaBadges(undefined, undefined).calendar.count).toBe(0)
  })

  it('uses the Mail inbox and Calendar upcoming summaries as the badge sources', () => {
    const session = fromPartial<Session>({
      capabilities: ref({ jmap: true, systemManager: false }),
    })

    expect(useAppRegistry(session).badges.value).toEqual({
      mail: { count: 7, quiet: false, parts: undefined },
      calendar: { count: 2, quiet: false },
    })
  })
})
