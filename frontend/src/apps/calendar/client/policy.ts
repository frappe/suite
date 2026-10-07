import type { Effects, OwnerRegistration } from '@/platform/server-state'

const eventReaders = [
  'events_get',
  'calendar.get_calendar_events',
  'get_calendar_events_with_shared',
  'get_calendar_event_density_with_shared',
  'search_calendar_events_with_shared',
]
const effects: Readonly<Record<string, Effects>> = {
  add_invite_to_calendar: { invalidates: [...eventReaders, 'get_invite_details'] },
  rsvp_to_invite: { invalidates: [...eventReaders, 'get_invite_details'] },
  create_calendar: { invalidates: ['get_calendars_with_shared'] },
  edit_calendar: { invalidates: ['get_calendars_with_shared', ...eventReaders] },
  delete_calendar: { invalidates: ['get_calendars_with_shared', ...eventReaders] },
  rsvp_calendar_event: { invalidates: eventReaders },
  add_calendar_event: { invalidates: eventReaders },
  update_calendar_event: { invalidates: eventReaders },
  update_calendar_event_instance: { invalidates: eventReaders },
  delete_calendar_events: { invalidates: eventReaders },
  delete_calendar_event_instance: { invalidates: eventReaders },
  split_calendar_event_series: { invalidates: eventReaders },
  delete_calendar_event_series_from: { invalidates: eventReaders },
}
export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = effects[reference.id]
    if (!effect) throw new TypeError(`Missing Calendar effects: ${reference.id}`)
    return { effects: effect }
  },
}
