import { describe, expect, it, vi } from 'vitest'

import { api } from '@/apps/calendar/client/api'
import dayjs from '@/apps/calendar/utils/dayjs'
import { formEventFields, gridEventFields, type EventForm } from '@/apps/calendar/utils/eventWrite'
import { api as meet } from '@/apps/meet/client/api'

vi.mock('@/apps/calendar/stores/user', () => ({
  userStore: () => ({ userResource: { data: { time_zone: 'Europe/Berlin' } } }),
}))
vi.spyOn(dayjs.tz, 'guess').mockReturnValue('Europe/Berlin')

/** Sends `input` through the generated contract check every request passes before it leaves. */
async function send(reference: { loadValidators?: () => Promise<unknown> }, input: unknown) {
  const validators = (await reference.loadValidators!()) as {
    validateInput(input: unknown): void
  }
  validators.validateInput(input)
  return input
}

const maya = {
  email: 'maya@northwind.test',
  _name: 'Maya',
  user_image: null,
  participation_status: 'ACCEPTED',
}
const sofia = {
  email: 'sofia@northwind.test',
  _name: 'Sofia',
  participation_status: 'NEEDS-ACTION',
}

// A new event as the form holds it once the reader has added Sofia and a reminder.
const newEvent: EventForm = {
  title: 'Launch review',
  organizer: maya.email,
  calendar_ids: ['b'],
  isAllDay: false,
  startDate: '2026-10-22',
  startTime: '10:00',
  endDate: '2026-10-22',
  endTime: '11:00',
  recurrence_rule: {},
  privacy: 'Public',
  free_busy_status: 'Busy',
  description: '',
  locations: ['Room 2', ''],
  links: [],
  participants: [maya, sofia],
  alerts: [
    {
      type: 'OffsetTrigger',
      action: 'Display',
      number: 10,
      unit: 'minutes',
      direction: -1,
      relative_to: 'Start',
    },
  ],
  followsDefaults: false,
}
const weekly = { frequency: 'weekly' as const, interval: 1, byDay: [{ day: 'mo' }] }
// One occurrence of a weekly series, as the grid hands it to the form.
const occurrence = {
  start: '2026-10-26T10:00:00',
  time_zone: 'Europe/Berlin',
  recurrence_id: '2026-10-26T10:00:00',
  master_start: '2026-10-19T10:00:00',
}

describe('calendar event writes', () => {
  it('sends every whole-event write the form makes in the shape the contract takes', async () => {
    const fields = formEventFields(newEvent, { scope: 'series' })
    expect(fields).toMatchObject({
      title: 'Launch review',
      start: '2026-10-22T10:00:00',
      duration: 'PT1H',
      time_zone: 'Europe/Berlin',
      locations: [{ name: 'Room 2' }],
      participants: [maya, sofia],
      alerts: [
        { action: 'Display', type: 'OffsetTrigger', offset: '-PT10M', relative_to: 'Start' },
      ],
    })
    const account = 'm'
    const send_scheduling_messages = true
    await send(api.events.create, { account, ...fields, draft: false, send_scheduling_messages })
    await send(api.events.create, { account, ...fields, draft: true, send_scheduling_messages })
    await send(meet.meetings.createCalendar, { account, ...fields, send_scheduling_messages })
    await send(api.events.update, { account, id: 'ba', uid: 'u1', ...fields, draft: false })

    const series = { ...newEvent, recurrence_rule: weekly, startDate: '2026-10-28' }
    for (const scope of ['series', 'following'] as const) {
      const edited = formEventFields(series, { occurrence, scope })
      await send(api.events.update, { account, id: 'ba', ...edited })
      await send(api.events.splitSeries, {
        account,
        master_id: 'ba',
        recurrence_id: occurrence.recurrence_id,
        ...edited,
      })
    }
  })

  it('writes a dragged event back with everything it had, the way the write spells it', async () => {
    const dragged = {
      name: 'm|ba',
      event_id: 'ba',
      account: 'm',
      id: 'm|ba',
      uid: 'u1',
      title: 'Launch review',
      actualTitle: 'Launch review',
      start: '2026-10-22T12:00:00',
      duration: 'PT1H',
      time_zone: 'Europe/Berlin',
      status: 'Confirmed',
      show_without_time: 0,
      draft: 1,
      use_default_alerts: 0,
      recurrence_rule: JSON.stringify(weekly),
      organizer: maya.email,
      calendars: [{ calendar: 'm|b', calendar_id: 'b', calendar_name: 'Work', color: null }],
      privacy: '',
      free_busy_status: 'Busy',
      description: '',
      locations: [{ uid: 'l1', _name: 'Room 2' }],
      links: [],
      participants: [maya, sofia],
      alerts: [{ uid: 'a1', action: 'display', type: 'OffsetTrigger', offset: '-PT10M' }],
      fromDate: '2026-10-22',
      isAllDay: false,
      isDraft: true,
      venue: 'Room 2',
      masterTimeZone: 'Europe/Berlin',
      startBeforeDrag: '2026-10-22T10:00:00',
    }
    const fields = gridEventFields(dragged)
    expect(fields).toMatchObject({
      calendar_ids: ['b'],
      draft: true,
      show_without_time: false,
      recurrence_rule: weekly,
      locations: [{ uid: 'l1', name: 'Room 2' }],
    })
    await send(api.events.update, { account: 'm', id: 'ba', uid: 'u1', ...fields })
    await send(api.events.splitSeries, {
      account: 'm',
      master_id: 'ba',
      recurrence_id: '2026-10-22T10:00:00',
      ...fields,
    })
  })

  it('refuses a field the contract does not declare before anything is sent', async () => {
    const fields = formEventFields(newEvent, { scope: 'series' })
    await expect(
      send(api.events.create, { account: 'm', ...fields, user: maya.email }),
    ).rejects.toThrow('add_calendar_event input.user is not allowed')
  })
})
