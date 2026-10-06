// Generated from src/apps/calendar/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type EventsGetOutputCalendarEvent = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<EventsGetOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<EventsGetOutputEventLink>
  participants: Array<EventsGetOutputParticipant>
  conferencing?: EventsGetOutputConferencing | null
}

export type EventsGetOutputConferencing = { meeting_id: string; url: string }

export type EventsGetOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type EventsGetOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type EventsGetOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type EventsGetInput = { from: string; to: string; account?: string }

export type EventsGetOutput = Array<EventsGetOutputCalendarEvent>

export type EventsGetError = 'BadRequest' | 'PermissionError'

const operationEventsGet: QueryRef<EventsGetInput, EventsGetOutput, EventsGetError> = {
  id: 'events_get',
  owner: 'calendar',
  kind: 'query',
  publicName: 'events.list',
  method: 'GET',
  path: 'events',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationEventsGet,
}

export type CalendarGetCalendarEventsOutputCalendarEvent = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<CalendarGetCalendarEventsOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<CalendarGetCalendarEventsOutputEventLink>
  participants: Array<CalendarGetCalendarEventsOutputParticipant>
  conferencing?: CalendarGetCalendarEventsOutputConferencing | null
}

export type CalendarGetCalendarEventsOutputConferencing = { meeting_id: string; url: string }

export type CalendarGetCalendarEventsOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type CalendarGetCalendarEventsOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type CalendarGetCalendarEventsOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type CalendarGetCalendarEventsInput = {
  account: string
  from_date: string
  to_date: string
  time_zone: string
}

export type CalendarGetCalendarEventsOutput = Array<CalendarGetCalendarEventsOutputCalendarEvent>

export type CalendarGetCalendarEventsError = never

const operationCalendarGetCalendarEvents: QueryRef<
  CalendarGetCalendarEventsInput,
  CalendarGetCalendarEventsOutput,
  CalendarGetCalendarEventsError
> = {
  id: 'calendar.get_calendar_events',
  owner: 'calendar',
  kind: 'query',
  publicName: 'events.window',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.get_calendar_events',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationCalendarGetCalendarEvents,
}

export type GetCalendarsWithSharedOutputCalendarRow = {
  name: string
  account: string
  id: string
  _name: string
  color: string | null
  default: 0 | 1
  visible: 0 | 1
  may_write_all: 0 | 1
  may_delete: 0 | 1
}

export type GetCalendarsWithSharedInput = { account: string }

export type GetCalendarsWithSharedOutput = Array<GetCalendarsWithSharedOutputCalendarRow>

export type GetCalendarsWithSharedError = 'PermissionError' | 'ValidationError'

const operationGetCalendarsWithShared: QueryRef<
  GetCalendarsWithSharedInput,
  GetCalendarsWithSharedOutput,
  GetCalendarsWithSharedError
> = {
  id: 'get_calendars_with_shared',
  owner: 'calendar',
  kind: 'query',
  publicName: 'calendars.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.get_calendars_with_shared',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetCalendarsWithShared,
}

export type GetCalendarEventsWithSharedOutputCalendarEvent = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<GetCalendarEventsWithSharedOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<GetCalendarEventsWithSharedOutputEventLink>
  participants: Array<GetCalendarEventsWithSharedOutputParticipant>
  conferencing?: GetCalendarEventsWithSharedOutputConferencing | null
}

export type GetCalendarEventsWithSharedOutputConferencing = { meeting_id: string; url: string }

export type GetCalendarEventsWithSharedOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type GetCalendarEventsWithSharedOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type GetCalendarEventsWithSharedOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type GetCalendarEventsWithSharedInput = {
  account: string
  from_date: string
  to_date: string
  time_zone: string
}

export type GetCalendarEventsWithSharedOutput =
  Array<GetCalendarEventsWithSharedOutputCalendarEvent>

export type GetCalendarEventsWithSharedError = 'PermissionError' | 'ValidationError'

const operationGetCalendarEventsWithShared: QueryRef<
  GetCalendarEventsWithSharedInput,
  GetCalendarEventsWithSharedOutput,
  GetCalendarEventsWithSharedError
> = {
  id: 'get_calendar_events_with_shared',
  owner: 'calendar',
  kind: 'query',
  publicName: 'events.sharedWindow',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.get_calendar_events_with_shared',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetCalendarEventsWithShared,
}

export type GetCalendarEventDensityWithSharedOutputDensityRow = {
  start: string
  duration: string
  time_zone: string
  show_without_time: 0 | 1
  calendars: Array<string>
  is_declined: boolean
}

export type GetCalendarEventDensityWithSharedInput = {
  account: string
  from_date: string
  to_date: string
  time_zone: string
}

export type GetCalendarEventDensityWithSharedOutput =
  Array<GetCalendarEventDensityWithSharedOutputDensityRow>

export type GetCalendarEventDensityWithSharedError = 'PermissionError' | 'ValidationError'

const operationGetCalendarEventDensityWithShared: QueryRef<
  GetCalendarEventDensityWithSharedInput,
  GetCalendarEventDensityWithSharedOutput,
  GetCalendarEventDensityWithSharedError
> = {
  id: 'get_calendar_event_density_with_shared',
  owner: 'calendar',
  kind: 'query',
  publicName: 'events.density',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.get_calendar_event_density_with_shared',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () =>
    (await import('./validators')).operationGetCalendarEventDensityWithShared,
}

export type SearchCalendarEventsWithSharedOutputCalendarEvent = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<SearchCalendarEventsWithSharedOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<SearchCalendarEventsWithSharedOutputEventLink>
  participants: Array<SearchCalendarEventsWithSharedOutputParticipant>
  conferencing?: SearchCalendarEventsWithSharedOutputConferencing | null
}

export type SearchCalendarEventsWithSharedOutputConferencing = { meeting_id: string; url: string }

export type SearchCalendarEventsWithSharedOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type SearchCalendarEventsWithSharedOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type SearchCalendarEventsWithSharedOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type SearchCalendarEventsWithSharedInput = {
  account: string
  text?: string | null
  limit?: number
  time_zone?: string | null
  filters?: { [key: string]: unknown } | null
}

export type SearchCalendarEventsWithSharedOutput =
  Array<SearchCalendarEventsWithSharedOutputCalendarEvent>

export type SearchCalendarEventsWithSharedError = 'PermissionError' | 'ValidationError'

const operationSearchCalendarEventsWithShared: QueryRef<
  SearchCalendarEventsWithSharedInput,
  SearchCalendarEventsWithSharedOutput,
  SearchCalendarEventsWithSharedError
> = {
  id: 'search_calendar_events_with_shared',
  owner: 'calendar',
  kind: 'query',
  publicName: 'events.search',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.search_calendar_events_with_shared',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () =>
    (await import('./validators')).operationSearchCalendarEventsWithShared,
}

export type CreateCalendarInput = { account: string; name: string; color?: string | null }

export type CreateCalendarOutput = string

export type CreateCalendarError = 'PermissionError' | 'ValidationError'

const operationCreateCalendar: MutationRef<
  CreateCalendarInput,
  CreateCalendarOutput,
  CreateCalendarError
> = {
  id: 'create_calendar',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'calendars.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.create_calendar',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateCalendar,
}

export type EditCalendarInput = {
  account: string
  id: string
  name?: string | null
  color?: string | null
  default?: boolean
  visible?: boolean | null
}

export type EditCalendarOutput = null

export type EditCalendarError = 'PermissionError' | 'ValidationError'

const operationEditCalendar: MutationRef<EditCalendarInput, EditCalendarOutput, EditCalendarError> =
  {
    id: 'edit_calendar',
    owner: 'calendar',
    kind: 'mutation',
    publicName: 'calendars.update',
    empty: true,
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.calendar.api.edit_calendar',
    prefix: '/api/suite/calendar/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationEditCalendar,
  }

export type DeleteCalendarInput = { account: string; id: string }

export type DeleteCalendarOutput = null

export type DeleteCalendarError = 'PermissionError' | 'ValidationError'

const operationDeleteCalendar: MutationRef<
  DeleteCalendarInput,
  DeleteCalendarOutput,
  DeleteCalendarError
> = {
  id: 'delete_calendar',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'calendars.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.delete_calendar',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteCalendar,
}

export type AddCalendarEventInput = {
  organizer?: string | null
  calendar_ids?: Array<string> | null
  status?: string
  draft?: boolean
  title?: string | null
  start?: string | null
  duration?: string | null
  time_zone?: string | null
  recurrence_rule?: { [key: string]: unknown } | null
  show_without_time?: boolean
  privacy?: string | null
  free_busy_status?: string | null
  description?: string | null
  locations?: Array<{ [key: string]: unknown }> | null
  links?: Array<{ [key: string]: unknown }> | null
  participants?: Array<{ [key: string]: unknown }> | null
  alerts?: Array<{ [key: string]: unknown }> | null
  use_default_alerts?: boolean
  account: string
  send_scheduling_messages?: boolean
}

export type AddCalendarEventOutput = string

export type AddCalendarEventError = 'PermissionError' | 'ValidationError'

const operationAddCalendarEvent: MutationRef<
  AddCalendarEventInput,
  AddCalendarEventOutput,
  AddCalendarEventError
> = {
  id: 'add_calendar_event',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddCalendarEvent,
}

export type UpdateCalendarEventInput = {
  organizer?: string | null
  calendar_ids?: Array<string> | null
  status?: string
  draft?: boolean
  title?: string | null
  start?: string | null
  duration?: string | null
  time_zone?: string | null
  recurrence_rule?: { [key: string]: unknown } | null
  show_without_time?: boolean
  privacy?: string | null
  free_busy_status?: string | null
  description?: string | null
  locations?: Array<{ [key: string]: unknown }> | null
  links?: Array<{ [key: string]: unknown }> | null
  participants?: Array<{ [key: string]: unknown }> | null
  alerts?: Array<{ [key: string]: unknown }> | null
  use_default_alerts?: boolean
  account: string
  send_scheduling_messages?: boolean
  id: string
  uid?: string | null
}

export type UpdateCalendarEventOutput = null

export type UpdateCalendarEventError = 'PermissionError' | 'ValidationError'

const operationUpdateCalendarEvent: MutationRef<
  UpdateCalendarEventInput,
  UpdateCalendarEventOutput,
  UpdateCalendarEventError
> = {
  id: 'update_calendar_event',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateCalendarEvent,
}

export type UpdateCalendarEventInstanceInput = {
  account: string
  master_id: string
  recurrence_id: string
  patch: { [key: string]: unknown }
  send_scheduling_messages?: boolean
}

export type UpdateCalendarEventInstanceOutput = null

export type UpdateCalendarEventInstanceError = 'PermissionError' | 'ValidationError'

const operationUpdateCalendarEventInstance: MutationRef<
  UpdateCalendarEventInstanceInput,
  UpdateCalendarEventInstanceOutput,
  UpdateCalendarEventInstanceError
> = {
  id: 'update_calendar_event_instance',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.updateInstance',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateCalendarEventInstance,
}

export type DeleteCalendarEventsInput = {
  account: string
  ids: Array<string>
  send_scheduling_messages?: boolean
}

export type DeleteCalendarEventsOutput = null

export type DeleteCalendarEventsError = 'PermissionError' | 'ValidationError'

const operationDeleteCalendarEvents: MutationRef<
  DeleteCalendarEventsInput,
  DeleteCalendarEventsOutput,
  DeleteCalendarEventsError
> = {
  id: 'delete_calendar_events',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteCalendarEvents,
}

export type DeleteCalendarEventInstanceInput = {
  account: string
  master_id: string
  recurrence_id: string
  send_scheduling_messages?: boolean
}

export type DeleteCalendarEventInstanceOutput = null

export type DeleteCalendarEventInstanceError = 'PermissionError' | 'ValidationError'

const operationDeleteCalendarEventInstance: MutationRef<
  DeleteCalendarEventInstanceInput,
  DeleteCalendarEventInstanceOutput,
  DeleteCalendarEventInstanceError
> = {
  id: 'delete_calendar_event_instance',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.deleteInstance',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_event_instance',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteCalendarEventInstance,
}

export type SplitCalendarEventSeriesInput = {
  organizer?: string | null
  calendar_ids?: Array<string> | null
  status?: string
  draft?: boolean
  title?: string | null
  start?: string | null
  duration?: string | null
  time_zone?: string | null
  recurrence_rule?: { [key: string]: unknown } | null
  show_without_time?: boolean
  privacy?: string | null
  free_busy_status?: string | null
  description?: string | null
  locations?: Array<{ [key: string]: unknown }> | null
  links?: Array<{ [key: string]: unknown }> | null
  participants?: Array<{ [key: string]: unknown }> | null
  alerts?: Array<{ [key: string]: unknown }> | null
  use_default_alerts?: boolean
  account: string
  send_scheduling_messages?: boolean
  master_id: string
  recurrence_id: string
}

export type SplitCalendarEventSeriesOutput = string

export type SplitCalendarEventSeriesError = 'PermissionError' | 'ValidationError'

const operationSplitCalendarEventSeries: MutationRef<
  SplitCalendarEventSeriesInput,
  SplitCalendarEventSeriesOutput,
  SplitCalendarEventSeriesError
> = {
  id: 'split_calendar_event_series',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.splitSeries',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.split_calendar_event_series',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSplitCalendarEventSeries,
}

export type DeleteCalendarEventSeriesFromInput = {
  account: string
  master_id: string
  recurrence_id: string
  send_scheduling_messages?: boolean
}

export type DeleteCalendarEventSeriesFromOutput = null

export type DeleteCalendarEventSeriesFromError = 'PermissionError' | 'ValidationError'

const operationDeleteCalendarEventSeriesFrom: MutationRef<
  DeleteCalendarEventSeriesFromInput,
  DeleteCalendarEventSeriesFromOutput,
  DeleteCalendarEventSeriesFromError
> = {
  id: 'delete_calendar_event_series_from',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.deleteFollowing',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.delete_calendar_event_series_from',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteCalendarEventSeriesFrom,
}

export type RsvpCalendarEventInput = {
  account: string
  id: string
  response: string
  recurrence_id?: string | null
}

export type RsvpCalendarEventOutput = null

export type RsvpCalendarEventError = 'PermissionError' | 'ValidationError'

const operationRsvpCalendarEvent: MutationRef<
  RsvpCalendarEventInput,
  RsvpCalendarEventOutput,
  RsvpCalendarEventError
> = {
  id: 'rsvp_calendar_event',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'events.respond',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.rsvp_calendar_event',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRsvpCalendarEvent,
}

export type GetInviteDetailsOutputCalendarEvent = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<GetInviteDetailsOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<GetInviteDetailsOutputEventLink>
  participants: Array<GetInviteDetailsOutputParticipant>
  conferencing?: GetInviteDetailsOutputConferencing | null
}

export type GetInviteDetailsOutputConferencing = { meeting_id: string; url: string }

export type GetInviteDetailsOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type GetInviteDetailsOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type GetInviteDetailsOutputInviteDetails = {
  uid: string
  method: string
  exists: boolean
  event: GetInviteDetailsOutputCalendarEvent
  participant: GetInviteDetailsOutputViewerParticipant | null
}

export type GetInviteDetailsOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type GetInviteDetailsOutputViewerParticipant = { uid: string; email: string; status: string }

export type GetInviteDetailsInput = { account: string; blob_id: string }

export type GetInviteDetailsOutput = GetInviteDetailsOutputInviteDetails | null

export type GetInviteDetailsError = never

const operationGetInviteDetails: QueryRef<
  GetInviteDetailsInput,
  GetInviteDetailsOutput,
  GetInviteDetailsError
> = {
  id: 'get_invite_details',
  owner: 'calendar',
  kind: 'query',
  publicName: 'invites.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.invites.get_invite_details',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetInviteDetails,
}

export type AddInviteToCalendarOutputConferencing = { meeting_id: string; url: string }

export type AddInviteToCalendarOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type AddInviteToCalendarOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type AddInviteToCalendarOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type AddInviteToCalendarInput = { account: string; blob_id: string }

export type AddInviteToCalendarOutput = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<AddInviteToCalendarOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<AddInviteToCalendarOutputEventLink>
  participants: Array<AddInviteToCalendarOutputParticipant>
  conferencing?: AddInviteToCalendarOutputConferencing | null
}

export type AddInviteToCalendarError = never

const operationAddInviteToCalendar: MutationRef<
  AddInviteToCalendarInput,
  AddInviteToCalendarOutput,
  AddInviteToCalendarError
> = {
  id: 'add_invite_to_calendar',
  owner: 'calendar',
  kind: 'mutation',
  publicName: 'invites.add',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.calendar.api.invites.add_invite_to_calendar',
  prefix: '/api/suite/calendar/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationAddInviteToCalendar,
}

export type RsvpToInviteOutputConferencing = { meeting_id: string; url: string }

export type RsvpToInviteOutputEventCalendar = {
  calendar: string
  calendar_id: string
  calendar_name: string | null
  color: string | null
}

export type RsvpToInviteOutputEventLink = {
  uid: string
  href: string | null
  content_type: string | null
}

export type RsvpToInviteOutputParticipant = {
  uid: string
  roles: { [key: string]: boolean }
  kind: string
  _name: string | null
  email: string
  schedule_id: string | null
  send_to: { [key: string]: string } | null
  participation_status: string
  expect_reply: 0 | 1
  description: string | null
  comment: string | null
  schedule_agent: string
  member_of: { [key: string]: boolean }
  user_image?: string | null
}

export type RsvpToInviteInput = {
  account: string
  blob_id: string
  response: 'accepted' | 'tentative' | 'declined'
}

export type RsvpToInviteOutput = {
  name: string
  account: string
  id: string
  uid: string
  title: string
  start: string
  duration: string
  time_zone: string
  status: string
  description: string
  show_without_time: 0 | 1
  recurrence_id: string | null
  recurrence_rule: string | { [key: string]: unknown } | null
  organizer: string
  calendars: Array<RsvpToInviteOutputEventCalendar>
  created: string | null
  draft: 0 | 1
  recurrence_id_time_zone: string
  privacy: string
  free_busy_status: string
  locations: Array<{ [key: string]: unknown }>
  alerts: Array<{ [key: string]: unknown }>
  use_default_alerts: 0 | 1
  created_utc: string
  updated_utc: string
  origin: boolean
  may_invite_self: 0 | 1
  may_invite_others: 0 | 1
  hide_attendees: 0 | 1
  creation: string
  modified: string
  sequence: number
  master_id?: string
  master_start?: string
  master_duration?: string
  links: Array<RsvpToInviteOutputEventLink>
  participants: Array<RsvpToInviteOutputParticipant>
  conferencing?: RsvpToInviteOutputConferencing | null
}

export type RsvpToInviteError = never

const operationRsvpToInvite: MutationRef<RsvpToInviteInput, RsvpToInviteOutput, RsvpToInviteError> =
  {
    id: 'rsvp_to_invite',
    owner: 'calendar',
    kind: 'mutation',
    publicName: 'invites.respond',
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.calendar.api.invites.rsvp_to_invite',
    prefix: '/api/suite/calendar/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: [],
    loadValidators: async () => (await import('./validators')).operationRsvpToInvite,
  }

export const api = {
  events: {
    list: operationEventsGet,
    window: operationCalendarGetCalendarEvents,
    sharedWindow: operationGetCalendarEventsWithShared,
    density: operationGetCalendarEventDensityWithShared,
    search: operationSearchCalendarEventsWithShared,
    create: operationAddCalendarEvent,
    update: operationUpdateCalendarEvent,
    updateInstance: operationUpdateCalendarEventInstance,
    delete: operationDeleteCalendarEvents,
    deleteInstance: operationDeleteCalendarEventInstance,
    splitSeries: operationSplitCalendarEventSeries,
    deleteFollowing: operationDeleteCalendarEventSeriesFrom,
    respond: operationRsvpCalendarEvent,
  },
  calendars: {
    list: operationGetCalendarsWithShared,
    create: operationCreateCalendar,
    update: operationEditCalendar,
    delete: operationDeleteCalendar,
  },
  invites: {
    get: operationGetInviteDetails,
    add: operationAddInviteToCalendar,
    respond: operationRsvpToInvite,
  },
} as const
