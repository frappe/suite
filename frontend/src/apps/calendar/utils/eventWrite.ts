import type { InputOf } from '@/api'
import type { api } from '@/apps/calendar/client/api'
import { fromEventZone, fromWallClock, shiftedMasterStart } from '@/apps/calendar/utils/datetime'
import dayjs from '@/apps/calendar/utils/dayjs'
import type { RecurrenceRule } from '@/apps/calendar/utils/format'
import { reanchoredRule } from '@/apps/calendar/utils/recurrence'
import type { RecurringScope } from '@/apps/calendar/utils/recurringScope'
import { userTimeZone } from '@/platform/time-zone'

/**
 * The fields every whole-event write takes: create, update, split and the Meet create. Each
 * write adds its own address (`account`, `id`, `master_id`, …) around them. The contract
 * refuses any key it does not declare, so these are always built field by field, never
 * spread from what the form or the grid holds.
 */
export type EventFields = Omit<
  InputOf<typeof api.events.create>,
  'account' | 'send_scheduling_messages'
>

type FormAlert =
  | { type: 'AbsoluteTrigger'; action: string; date: string; time: string }
  | {
      type: 'OffsetTrigger'
      action: string
      number: number
      unit: string
      direction: number
      relative_to?: string
    }

/** What the event form holds. */
export interface EventForm {
  title?: string
  organizer?: string
  calendar_ids?: string[]
  isAllDay?: boolean
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
  recurrence_rule?: RecurrenceRule | { frequency?: never }
  privacy?: string
  free_busy_status?: string
  description?: string
  locations?: string[]
  links?: Record<string, unknown>[]
  participants?: Record<string, unknown>[]
  alerts?: FormAlert[]
  followsDefaults?: boolean
}

/** The occurrence the form was opened on, as the grid holds it. */
export interface OpenedOccurrence {
  start: string
  time_zone?: string | null
  isAllDay?: boolean
  recurrence_id?: string | null
  master_start?: string
}

/**
 * The occurrence's own start, as the form reads it. Timed events edit in the viewer's zone
 * (saving re-zones them to it); all-day events keep their calendar date.
 */
export const occurrenceStart = (occurrence: OpenedOccurrence) =>
  occurrence.isAllDay
    ? dayjs(occurrence.start)
    : fromEventZone(occurrence.start, occurrence.time_zone)

export const formStart = (form: EventForm) =>
  dayjs(`${form.startDate}T${form.isAllDay ? '00:00' : form.startTime}`)

const formDuration = (form: EventForm) => {
  if (form.isAllDay) {
    const days = dayjs(form.endDate).diff(dayjs(form.startDate), 'day') + 1
    return dayjs.duration({ days }).toISOString()
  }
  const start = dayjs(`${form.startDate}T${form.startTime}`)
  const end = dayjs(`${form.endDate}T${form.endTime}`)
  const diff = dayjs.duration(end.diff(start))
  return dayjs
    .duration({ hours: Math.floor(diff.asHours()), minutes: diff.minutes() })
    .toISOString()
}

const alertFields = (alert: FormAlert) =>
  alert.type === 'AbsoluteTrigger'
    ? // The date/time inputs are a wall clock in the user's zone; the API takes UTC.
      { action: alert.action, type: alert.type, when: fromWallClock(`${alert.date}T${alert.time}`) }
    : {
        action: alert.action,
        type: alert.type,
        offset: dayjs.duration({ [alert.unit]: alert.number * alert.direction }).toISOString(),
        relative_to: alert.relative_to,
      }

/** The fields the event form writes. `scope` says how far an edit of a recurring event reaches. */
export function formEventFields(
  form: EventForm,
  { occurrence, scope }: { occurrence?: OpenedOccurrence; scope: RecurringScope },
): EventFields {
  const startsAt = formStart(form)
  const fields: EventFields = {
    organizer: form.organizer,
    start: startsAt.format('YYYY-MM-DD[T]HH:mm:ss'),
    duration: formDuration(form),
    // Without this the server sees a timed midnight event and applies the
    // wrong default alert (10 mins before instead of 9am day-of).
    show_without_time: !!form.isAllDay,
  }
  if (form.title) fields.title = form.title
  // Updates are a full replace: an event saved without its calendars lands in the default one.
  if (form.calendar_ids?.length) fields.calendar_ids = form.calendar_ids
  fields.time_zone = userTimeZone()

  // Saving the whole series from one of its occurrences. The start on screen belongs to that
  // occurrence, so what reaches the master is the shift the reader made to it — nothing at all
  // when they made none, which is how the anchor used to pass through untouched. It keeps the
  // master's zone either way: pairing the master's wall clock with the browser's zone would
  // move the series on its own.
  if (occurrence?.recurrence_id && scope === 'series') {
    // An unresolved master (no master_start) is already past saving — the update is addressed by
    // master_id too, and falls back to an id the server won't take — so it is left exactly as it
    // was rather than given a start of this occurrence's, or of now.
    fields.start = occurrence.master_start
      ? shiftedMasterStart(occurrence.master_start, occurrenceStart(occurrence), startsAt)
      : occurrence.master_start
    fields.time_zone = occurrence.time_zone || fields.time_zone
  }
  const rule = form.recurrence_rule
  if (rule?.frequency) fields.recurrence_rule = { ...anchored(rule, fields, occurrence, scope) }
  if (form.privacy) fields.privacy = form.privacy
  if (form.free_busy_status) fields.free_busy_status = form.free_busy_status
  if (form.description) fields.description = form.description
  const locations = form.locations?.filter((name) => name?.trim())
  if (locations?.length) fields.locations = locations.map((name) => ({ name }))
  // Always carry existing links on updates — the JMAP update is a full replace,
  // so omitting them would strip Meet links from the event.
  if (form.links?.length) fields.links = form.links
  if (form.participants?.length) fields.participants = form.participants
  if (form.alerts?.length) fields.alerts = form.alerts.map(alertFields)
  // Updates send these fields whole, so an unrelated edit must say the event still follows the
  // calendar's defaults.
  else if (form.followsDefaults) fields.use_default_alerts = true
  // An empty list is a choice: removing the pre-filled default row means no reminder at all,
  // so the clear must reach the server.
  else fields.alerts = []
  return fields
}

/**
 * A rule names its days by reading them off the start, and does not re-read them when the
 * anchor moves. Left alone, a Monday series edited onto a Wednesday starts on Wednesday and
 * repeats on Mondays — so the occurrence just edited matches nothing the rule generates and is
 * not drawn at all. Which start was the anchor depends on what is being written: the series is
 * anchored at the master's start, the half a split begins at the occurrence the reader opened.
 * Both ends read the same way. A split is anchored where the form opened this occurrence and
 * starts where the form now says — both the viewer's clock. The series is anchored at the
 * master's start and moves to the one computed from it — both the event's.
 */
function anchored(
  rule: RecurrenceRule,
  fields: EventFields,
  occurrence: OpenedOccurrence | undefined,
  scope: RecurringScope,
): RecurrenceRule {
  if (!occurrence?.recurrence_id) return rule
  const anchorWas =
    scope === 'following' ? occurrenceStart(occurrence) : dayjs(occurrence.master_start)
  const start = dayjs(fields.start)
  return anchorWas.isValid() && !anchorWas.isSame(start, 'day')
    ? reanchoredRule(rule, anchorWas, start)
    : rule
}

/** An event as the grid holds it after a drag: the server's event, moved. */
export interface GridEvent {
  organizer?: string
  calendars?: { calendar_id: string }[]
  status?: string
  draft?: number | boolean
  title?: string
  start?: string
  duration?: string
  time_zone?: string
  recurrence_rule?: string | Record<string, unknown> | null
  show_without_time?: number | boolean
  privacy?: string
  free_busy_status?: string
  description?: string
  locations?: { uid?: string; _name?: string }[]
  links?: Record<string, unknown>[]
  participants?: Record<string, unknown>[]
  alerts?: Record<string, unknown>[]
  use_default_alerts?: number | boolean
}

/**
 * The fields a drag writes back. The update is a full replace, so everything the event has is
 * carried over, read the way the write spells it: flags as booleans, calendars by id.
 */
export function gridEventFields(event: GridEvent): EventFields {
  const rule = event.recurrence_rule
  return {
    organizer: event.organizer,
    calendar_ids: event.calendars?.map((calendar) => calendar.calendar_id),
    status: event.status,
    draft: !!event.draft,
    title: event.title,
    start: event.start,
    duration: event.duration,
    time_zone: event.time_zone,
    // A series created moments ago can still carry its rule as the stored JSON string.
    recurrence_rule: typeof rule === 'string' ? JSON.parse(rule) : rule,
    show_without_time: !!event.show_without_time,
    privacy: event.privacy,
    free_busy_status: event.free_busy_status,
    description: event.description,
    locations: event.locations?.map((location) => ({ uid: location.uid, name: location._name })),
    links: event.links,
    participants: event.participants,
    alerts: event.alerts,
    use_default_alerts: !!event.use_default_alerts,
  }
}
