import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { areaDefinitions, deriveAreaBadges, useAppRegistry } from '@/composition/appRegistry'
import type { Session } from '@/platform/session'

const registryState = vi.hoisted(() => ({
  inbox: { data: { unread: 7 } },
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
    ])
  })

  it('lists every area even when the session lacks a capability', () => {
    const session = {
      capabilities: ref({ jmap: false, systemManager: false }),
    } as unknown as Session

    expect(useAppRegistry(session).areas.map((area) => area.id)).toEqual([
      'home',
      'files',
      'mail',
      'calendar',
      'meet',
      'people',
    ])
  })

  it('derives the Mail badge from the inbox unread summary', () => {
    expect(deriveAreaBadges({ unread: 7 })).toEqual({ mail: 7, calendar: 0 })
    expect(deriveAreaBadges(undefined)).toEqual({ mail: 0, calendar: 0 })
    expect(deriveAreaBadges({ unread: -1 })).toEqual({ mail: 0, calendar: 0 })
  })

  it('derives the Calendar badge from what is left of the day', () => {
    expect(deriveAreaBadges(undefined, { upcoming: 3 })).toEqual({ mail: 0, calendar: 3 })
    expect(deriveAreaBadges(undefined, undefined)).toEqual({ mail: 0, calendar: 0 })
  })

  it('uses the Mail inbox and Calendar upcoming summaries as the badge sources', () => {
    const session = {
      capabilities: ref({ jmap: true, systemManager: false }),
    } as unknown as Session

    expect(useAppRegistry(session).badges.value).toEqual({ mail: 7, calendar: 2 })
  })
})
