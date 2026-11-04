// Generated from src/apps/calendar/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AddCalendarEventInput,
  AddCalendarEventOutput,
  AddInviteToCalendarInput,
  AddInviteToCalendarOutput,
  CalendarGetCalendarEventsInput,
  CalendarGetCalendarEventsOutput,
  CreateCalendarInput,
  CreateCalendarOutput,
  DeleteCalendarEventInstanceInput,
  DeleteCalendarEventInstanceOutput,
  DeleteCalendarEventSeriesFromInput,
  DeleteCalendarEventSeriesFromOutput,
  DeleteCalendarEventsInput,
  DeleteCalendarEventsOutput,
  DeleteCalendarInput,
  DeleteCalendarOutput,
  EditCalendarInput,
  EditCalendarOutput,
  EventsGetInput,
  EventsGetOutput,
  GetCalendarEventDensityWithSharedInput,
  GetCalendarEventDensityWithSharedOutput,
  GetCalendarEventsWithSharedInput,
  GetCalendarEventsWithSharedOutput,
  GetCalendarsWithSharedInput,
  GetCalendarsWithSharedOutput,
  GetInviteDetailsInput,
  GetInviteDetailsOutput,
  RsvpCalendarEventInput,
  RsvpCalendarEventOutput,
  RsvpToInviteInput,
  RsvpToInviteOutput,
  SearchCalendarEventsWithSharedInput,
  SearchCalendarEventsWithSharedOutput,
  SplitCalendarEventSeriesInput,
  SplitCalendarEventSeriesOutput,
  UpcomingSummaryInput,
  UpcomingSummaryOutput,
  UpdateCalendarEventInput,
  UpdateCalendarEventInstanceInput,
  UpdateCalendarEventInstanceOutput,
  UpdateCalendarEventOutput,
} from './generated'

export const operationEventsGet: Validators<EventsGetInput, EventsGetOutput> = {
  validateInput(value: unknown): asserts value is EventsGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          from: { title: 'From', type: 'string' },
          to: { title: 'To', type: 'string' },
          account: { title: 'Account', type: 'string' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
        $defs: {},
      },
      'events_get input',
    )
  },
  validateOutput(value: unknown): asserts value is EventsGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          CalendarEvent: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              uid: { title: 'Uid', type: 'string' },
              title: { title: 'Title', type: 'string' },
              start: { title: 'Start', type: 'string' },
              duration: { title: 'Duration', type: 'string' },
              time_zone: { title: 'Time Zone', type: 'string' },
              status: { title: 'Status', type: 'string' },
              description: { title: 'Description', type: 'string' },
              show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
              recurrence_id: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Recurrence Id',
              },
              recurrence_rule: {
                anyOf: [
                  { type: 'string' },
                  { additionalProperties: true, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Recurrence Rule',
              },
              organizer: { title: 'Organizer', type: 'string' },
              calendars: {
                items: { $ref: '#/$defs/EventCalendar' },
                title: 'Calendars',
                type: 'array',
              },
              created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
              privacy: { title: 'Privacy', type: 'string' },
              free_busy_status: { title: 'Free Busy Status', type: 'string' },
              locations: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Locations',
                type: 'array',
              },
              alerts: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Alerts',
                type: 'array',
              },
              use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
              created_utc: { title: 'Created Utc', type: 'string' },
              updated_utc: { title: 'Updated Utc', type: 'string' },
              origin: { title: 'Origin', type: 'boolean' },
              may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
              may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
              hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
              sequence: { title: 'Sequence', type: 'integer' },
              master_id: { title: 'Master Id', type: 'string' },
              master_start: { title: 'Master Start', type: 'string' },
              master_duration: { title: 'Master Duration', type: 'string' },
              links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
              participants: {
                items: { $ref: '#/$defs/Participant' },
                title: 'Participants',
                type: 'array',
              },
              conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
            },
            required: [
              'name',
              'account',
              'id',
              'uid',
              'title',
              'start',
              'duration',
              'time_zone',
              'status',
              'description',
              'show_without_time',
              'recurrence_id',
              'recurrence_rule',
              'organizer',
              'calendars',
              'created',
              'draft',
              'recurrence_id_time_zone',
              'privacy',
              'free_busy_status',
              'locations',
              'alerts',
              'use_default_alerts',
              'created_utc',
              'updated_utc',
              'origin',
              'may_invite_self',
              'may_invite_others',
              'hide_attendees',
              'creation',
              'modified',
              'sequence',
              'links',
              'participants',
            ],
            title: 'CalendarEvent',
            type: 'object',
          },
          Conferencing: {
            properties: {
              meeting_id: { title: 'Meeting Id', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['meeting_id', 'url'],
            title: 'Conferencing',
            type: 'object',
          },
          EventCalendar: {
            properties: {
              calendar: { title: 'Calendar', type: 'string' },
              calendar_id: { title: 'Calendar Id', type: 'string' },
              calendar_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Calendar Name',
              },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
            },
            required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
            title: 'EventCalendar',
            type: 'object',
          },
          EventLink: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
              content_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Content Type',
              },
            },
            required: ['uid', 'href', 'content_type'],
            title: 'EventLink',
            type: 'object',
          },
          Participant: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              roles: { additionalProperties: { type: 'boolean' }, title: 'Roles', type: 'object' },
              kind: { title: 'Kind', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              schedule_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Schedule Id' },
              send_to: {
                anyOf: [
                  { additionalProperties: { type: 'string' }, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Send To',
              },
              participation_status: { title: 'Participation Status', type: 'string' },
              expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
              schedule_agent: { title: 'Schedule Agent', type: 'string' },
              member_of: {
                additionalProperties: { type: 'boolean' },
                title: 'Member Of',
                type: 'object',
              },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'uid',
              'roles',
              'kind',
              '_name',
              'email',
              'schedule_id',
              'send_to',
              'participation_status',
              'expect_reply',
              'description',
              'comment',
              'schedule_agent',
              'member_of',
            ],
            title: 'Participant',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/CalendarEvent' },
        type: 'array',
      },
      'events_get output',
    )
  },
}

export const operationUpcomingSummary: Validators<UpcomingSummaryInput, UpcomingSummaryOutput> = {
  validateInput(value: unknown): asserts value is UpcomingSummaryInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          from: { title: 'From', type: 'string' },
          to: { title: 'To', type: 'string' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
        $defs: {},
      },
      'upcoming_summary input',
    )
  },
  validateOutput(value: unknown): asserts value is UpcomingSummaryOutput {
    assertSchema(
      value,
      {
        properties: { upcoming: { title: 'Upcoming', type: 'integer' } },
        required: ['upcoming'],
        title: 'UpcomingSummary',
        type: 'object',
      },
      'upcoming_summary output',
    )
  },
}

export const operationCalendarGetCalendarEvents: Validators<
  CalendarGetCalendarEventsInput,
  CalendarGetCalendarEventsOutput
> = {
  validateInput(value: unknown): asserts value is CalendarGetCalendarEventsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_date: { title: 'From Date', type: 'string' },
          to_date: { title: 'To Date', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
        },
        required: ['account', 'from_date', 'to_date', 'time_zone'],
        additionalProperties: false,
        $defs: {},
      },
      'calendar.get_calendar_events input',
    )
  },
  validateOutput(value: unknown): asserts value is CalendarGetCalendarEventsOutput {
    assertSchema(
      value,
      {
        $defs: {
          CalendarEvent: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              uid: { title: 'Uid', type: 'string' },
              title: { title: 'Title', type: 'string' },
              start: { title: 'Start', type: 'string' },
              duration: { title: 'Duration', type: 'string' },
              time_zone: { title: 'Time Zone', type: 'string' },
              status: { title: 'Status', type: 'string' },
              description: { title: 'Description', type: 'string' },
              show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
              recurrence_id: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Recurrence Id',
              },
              recurrence_rule: {
                anyOf: [
                  { type: 'string' },
                  { additionalProperties: true, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Recurrence Rule',
              },
              organizer: { title: 'Organizer', type: 'string' },
              calendars: {
                items: { $ref: '#/$defs/EventCalendar' },
                title: 'Calendars',
                type: 'array',
              },
              created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
              privacy: { title: 'Privacy', type: 'string' },
              free_busy_status: { title: 'Free Busy Status', type: 'string' },
              locations: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Locations',
                type: 'array',
              },
              alerts: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Alerts',
                type: 'array',
              },
              use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
              created_utc: { title: 'Created Utc', type: 'string' },
              updated_utc: { title: 'Updated Utc', type: 'string' },
              origin: { title: 'Origin', type: 'boolean' },
              may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
              may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
              hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
              sequence: { title: 'Sequence', type: 'integer' },
              master_id: { title: 'Master Id', type: 'string' },
              master_start: { title: 'Master Start', type: 'string' },
              master_duration: { title: 'Master Duration', type: 'string' },
              links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
              participants: {
                items: { $ref: '#/$defs/Participant' },
                title: 'Participants',
                type: 'array',
              },
              conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
            },
            required: [
              'name',
              'account',
              'id',
              'uid',
              'title',
              'start',
              'duration',
              'time_zone',
              'status',
              'description',
              'show_without_time',
              'recurrence_id',
              'recurrence_rule',
              'organizer',
              'calendars',
              'created',
              'draft',
              'recurrence_id_time_zone',
              'privacy',
              'free_busy_status',
              'locations',
              'alerts',
              'use_default_alerts',
              'created_utc',
              'updated_utc',
              'origin',
              'may_invite_self',
              'may_invite_others',
              'hide_attendees',
              'creation',
              'modified',
              'sequence',
              'links',
              'participants',
            ],
            title: 'CalendarEvent',
            type: 'object',
          },
          Conferencing: {
            properties: {
              meeting_id: { title: 'Meeting Id', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['meeting_id', 'url'],
            title: 'Conferencing',
            type: 'object',
          },
          EventCalendar: {
            properties: {
              calendar: { title: 'Calendar', type: 'string' },
              calendar_id: { title: 'Calendar Id', type: 'string' },
              calendar_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Calendar Name',
              },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
            },
            required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
            title: 'EventCalendar',
            type: 'object',
          },
          EventLink: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
              content_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Content Type',
              },
            },
            required: ['uid', 'href', 'content_type'],
            title: 'EventLink',
            type: 'object',
          },
          Participant: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              roles: { additionalProperties: { type: 'boolean' }, title: 'Roles', type: 'object' },
              kind: { title: 'Kind', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              schedule_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Schedule Id' },
              send_to: {
                anyOf: [
                  { additionalProperties: { type: 'string' }, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Send To',
              },
              participation_status: { title: 'Participation Status', type: 'string' },
              expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
              schedule_agent: { title: 'Schedule Agent', type: 'string' },
              member_of: {
                additionalProperties: { type: 'boolean' },
                title: 'Member Of',
                type: 'object',
              },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'uid',
              'roles',
              'kind',
              '_name',
              'email',
              'schedule_id',
              'send_to',
              'participation_status',
              'expect_reply',
              'description',
              'comment',
              'schedule_agent',
              'member_of',
            ],
            title: 'Participant',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/CalendarEvent' },
        type: 'array',
      },
      'calendar.get_calendar_events output',
    )
  },
}

export const operationGetCalendarsWithShared: Validators<
  GetCalendarsWithSharedInput,
  GetCalendarsWithSharedOutput
> = {
  validateInput(value: unknown): asserts value is GetCalendarsWithSharedInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_calendars_with_shared input',
    )
  },
  validateOutput(value: unknown): asserts value is GetCalendarsWithSharedOutput {
    assertSchema(
      value,
      {
        $defs: {
          CalendarRow: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { title: 'Name', type: 'string' },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
              default: { enum: [0, 1], type: 'integer', title: 'Default' },
              visible: { enum: [0, 1], title: 'Visible', type: 'integer' },
              may_write_all: { enum: [0, 1], title: 'May Write All', type: 'integer' },
              may_delete: { enum: [0, 1], title: 'May Delete', type: 'integer' },
            },
            required: [
              'name',
              'account',
              'id',
              '_name',
              'color',
              'default',
              'visible',
              'may_write_all',
              'may_delete',
            ],
            title: 'CalendarRow',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/CalendarRow' },
        type: 'array',
      },
      'get_calendars_with_shared output',
    )
  },
}

export const operationGetCalendarEventsWithShared: Validators<
  GetCalendarEventsWithSharedInput,
  GetCalendarEventsWithSharedOutput
> = {
  validateInput(value: unknown): asserts value is GetCalendarEventsWithSharedInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_date: { title: 'From Date', type: 'string' },
          to_date: { title: 'To Date', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
        },
        required: ['account', 'from_date', 'to_date', 'time_zone'],
        additionalProperties: false,
        $defs: {},
      },
      'get_calendar_events_with_shared input',
    )
  },
  validateOutput(value: unknown): asserts value is GetCalendarEventsWithSharedOutput {
    assertSchema(
      value,
      {
        $defs: {
          CalendarEvent: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              uid: { title: 'Uid', type: 'string' },
              title: { title: 'Title', type: 'string' },
              start: { title: 'Start', type: 'string' },
              duration: { title: 'Duration', type: 'string' },
              time_zone: { title: 'Time Zone', type: 'string' },
              status: { title: 'Status', type: 'string' },
              description: { title: 'Description', type: 'string' },
              show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
              recurrence_id: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Recurrence Id',
              },
              recurrence_rule: {
                anyOf: [
                  { type: 'string' },
                  { additionalProperties: true, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Recurrence Rule',
              },
              organizer: { title: 'Organizer', type: 'string' },
              calendars: {
                items: { $ref: '#/$defs/EventCalendar' },
                title: 'Calendars',
                type: 'array',
              },
              created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
              privacy: { title: 'Privacy', type: 'string' },
              free_busy_status: { title: 'Free Busy Status', type: 'string' },
              locations: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Locations',
                type: 'array',
              },
              alerts: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Alerts',
                type: 'array',
              },
              use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
              created_utc: { title: 'Created Utc', type: 'string' },
              updated_utc: { title: 'Updated Utc', type: 'string' },
              origin: { title: 'Origin', type: 'boolean' },
              may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
              may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
              hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
              sequence: { title: 'Sequence', type: 'integer' },
              master_id: { title: 'Master Id', type: 'string' },
              master_start: { title: 'Master Start', type: 'string' },
              master_duration: { title: 'Master Duration', type: 'string' },
              links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
              participants: {
                items: { $ref: '#/$defs/Participant' },
                title: 'Participants',
                type: 'array',
              },
              conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
            },
            required: [
              'name',
              'account',
              'id',
              'uid',
              'title',
              'start',
              'duration',
              'time_zone',
              'status',
              'description',
              'show_without_time',
              'recurrence_id',
              'recurrence_rule',
              'organizer',
              'calendars',
              'created',
              'draft',
              'recurrence_id_time_zone',
              'privacy',
              'free_busy_status',
              'locations',
              'alerts',
              'use_default_alerts',
              'created_utc',
              'updated_utc',
              'origin',
              'may_invite_self',
              'may_invite_others',
              'hide_attendees',
              'creation',
              'modified',
              'sequence',
              'links',
              'participants',
            ],
            title: 'CalendarEvent',
            type: 'object',
          },
          Conferencing: {
            properties: {
              meeting_id: { title: 'Meeting Id', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['meeting_id', 'url'],
            title: 'Conferencing',
            type: 'object',
          },
          EventCalendar: {
            properties: {
              calendar: { title: 'Calendar', type: 'string' },
              calendar_id: { title: 'Calendar Id', type: 'string' },
              calendar_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Calendar Name',
              },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
            },
            required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
            title: 'EventCalendar',
            type: 'object',
          },
          EventLink: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
              content_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Content Type',
              },
            },
            required: ['uid', 'href', 'content_type'],
            title: 'EventLink',
            type: 'object',
          },
          Participant: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              roles: { additionalProperties: { type: 'boolean' }, title: 'Roles', type: 'object' },
              kind: { title: 'Kind', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              schedule_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Schedule Id' },
              send_to: {
                anyOf: [
                  { additionalProperties: { type: 'string' }, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Send To',
              },
              participation_status: { title: 'Participation Status', type: 'string' },
              expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
              schedule_agent: { title: 'Schedule Agent', type: 'string' },
              member_of: {
                additionalProperties: { type: 'boolean' },
                title: 'Member Of',
                type: 'object',
              },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'uid',
              'roles',
              'kind',
              '_name',
              'email',
              'schedule_id',
              'send_to',
              'participation_status',
              'expect_reply',
              'description',
              'comment',
              'schedule_agent',
              'member_of',
            ],
            title: 'Participant',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/CalendarEvent' },
        type: 'array',
      },
      'get_calendar_events_with_shared output',
    )
  },
}

export const operationGetCalendarEventDensityWithShared: Validators<
  GetCalendarEventDensityWithSharedInput,
  GetCalendarEventDensityWithSharedOutput
> = {
  validateInput(value: unknown): asserts value is GetCalendarEventDensityWithSharedInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_date: { title: 'From Date', type: 'string' },
          to_date: { title: 'To Date', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
        },
        required: ['account', 'from_date', 'to_date', 'time_zone'],
        additionalProperties: false,
        $defs: {},
      },
      'get_calendar_event_density_with_shared input',
    )
  },
  validateOutput(value: unknown): asserts value is GetCalendarEventDensityWithSharedOutput {
    assertSchema(
      value,
      {
        $defs: {
          DensityRow: {
            properties: {
              start: { title: 'Start', type: 'string' },
              duration: { title: 'Duration', type: 'string' },
              time_zone: { title: 'Time Zone', type: 'string' },
              show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
              calendars: { items: { type: 'string' }, title: 'Calendars', type: 'array' },
              is_declined: { title: 'Is Declined', type: 'boolean' },
            },
            required: [
              'start',
              'duration',
              'time_zone',
              'show_without_time',
              'calendars',
              'is_declined',
            ],
            title: 'DensityRow',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/DensityRow' },
        type: 'array',
      },
      'get_calendar_event_density_with_shared output',
    )
  },
}

export const operationSearchCalendarEventsWithShared: Validators<
  SearchCalendarEventsWithSharedInput,
  SearchCalendarEventsWithSharedOutput
> = {
  validateInput(value: unknown): asserts value is SearchCalendarEventsWithSharedInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          text: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Text' },
          limit: { default: 20, title: 'Limit', type: 'integer' },
          time_zone: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Time Zone',
          },
          filters: {
            anyOf: [{ additionalProperties: true, type: 'object' }, { type: 'null' }],
            default: null,
            title: 'Filters',
          },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'search_calendar_events_with_shared input',
    )
  },
  validateOutput(value: unknown): asserts value is SearchCalendarEventsWithSharedOutput {
    assertSchema(
      value,
      {
        $defs: {
          CalendarEvent: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              uid: { title: 'Uid', type: 'string' },
              title: { title: 'Title', type: 'string' },
              start: { title: 'Start', type: 'string' },
              duration: { title: 'Duration', type: 'string' },
              time_zone: { title: 'Time Zone', type: 'string' },
              status: { title: 'Status', type: 'string' },
              description: { title: 'Description', type: 'string' },
              show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
              recurrence_id: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Recurrence Id',
              },
              recurrence_rule: {
                anyOf: [
                  { type: 'string' },
                  { additionalProperties: true, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Recurrence Rule',
              },
              organizer: { title: 'Organizer', type: 'string' },
              calendars: {
                items: { $ref: '#/$defs/EventCalendar' },
                title: 'Calendars',
                type: 'array',
              },
              created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
              privacy: { title: 'Privacy', type: 'string' },
              free_busy_status: { title: 'Free Busy Status', type: 'string' },
              locations: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Locations',
                type: 'array',
              },
              alerts: {
                items: { additionalProperties: true, type: 'object' },
                title: 'Alerts',
                type: 'array',
              },
              use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
              created_utc: { title: 'Created Utc', type: 'string' },
              updated_utc: { title: 'Updated Utc', type: 'string' },
              origin: { title: 'Origin', type: 'boolean' },
              may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
              may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
              hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
              sequence: { title: 'Sequence', type: 'integer' },
              master_id: { title: 'Master Id', type: 'string' },
              master_start: { title: 'Master Start', type: 'string' },
              master_duration: { title: 'Master Duration', type: 'string' },
              links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
              participants: {
                items: { $ref: '#/$defs/Participant' },
                title: 'Participants',
                type: 'array',
              },
              conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
            },
            required: [
              'name',
              'account',
              'id',
              'uid',
              'title',
              'start',
              'duration',
              'time_zone',
              'status',
              'description',
              'show_without_time',
              'recurrence_id',
              'recurrence_rule',
              'organizer',
              'calendars',
              'created',
              'draft',
              'recurrence_id_time_zone',
              'privacy',
              'free_busy_status',
              'locations',
              'alerts',
              'use_default_alerts',
              'created_utc',
              'updated_utc',
              'origin',
              'may_invite_self',
              'may_invite_others',
              'hide_attendees',
              'creation',
              'modified',
              'sequence',
              'links',
              'participants',
            ],
            title: 'CalendarEvent',
            type: 'object',
          },
          Conferencing: {
            properties: {
              meeting_id: { title: 'Meeting Id', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['meeting_id', 'url'],
            title: 'Conferencing',
            type: 'object',
          },
          EventCalendar: {
            properties: {
              calendar: { title: 'Calendar', type: 'string' },
              calendar_id: { title: 'Calendar Id', type: 'string' },
              calendar_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Calendar Name',
              },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
            },
            required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
            title: 'EventCalendar',
            type: 'object',
          },
          EventLink: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
              content_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Content Type',
              },
            },
            required: ['uid', 'href', 'content_type'],
            title: 'EventLink',
            type: 'object',
          },
          Participant: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              roles: { additionalProperties: { type: 'boolean' }, title: 'Roles', type: 'object' },
              kind: { title: 'Kind', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              schedule_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Schedule Id' },
              send_to: {
                anyOf: [
                  { additionalProperties: { type: 'string' }, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Send To',
              },
              participation_status: { title: 'Participation Status', type: 'string' },
              expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
              schedule_agent: { title: 'Schedule Agent', type: 'string' },
              member_of: {
                additionalProperties: { type: 'boolean' },
                title: 'Member Of',
                type: 'object',
              },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'uid',
              'roles',
              'kind',
              '_name',
              'email',
              'schedule_id',
              'send_to',
              'participation_status',
              'expect_reply',
              'description',
              'comment',
              'schedule_agent',
              'member_of',
            ],
            title: 'Participant',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/CalendarEvent' },
        type: 'array',
      },
      'search_calendar_events_with_shared output',
    )
  },
}

export const operationCreateCalendar: Validators<CreateCalendarInput, CreateCalendarOutput> = {
  validateInput(value: unknown): asserts value is CreateCalendarInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          name: { title: 'Name', type: 'string' },
          color: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Color' },
        },
        required: ['account', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'create_calendar input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateCalendarOutput {
    assertSchema(value, { type: 'string' }, 'create_calendar output')
  },
}

export const operationEditCalendar: Validators<EditCalendarInput, EditCalendarOutput> = {
  validateInput(value: unknown): asserts value is EditCalendarInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          name: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Name' },
          color: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Color' },
          default: { type: 'boolean', default: false, title: 'Default' },
          visible: {
            anyOf: [{ type: 'boolean' }, { type: 'null' }],
            default: null,
            title: 'Visible',
          },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'edit_calendar input',
    )
  },
  validateOutput(value: unknown): asserts value is EditCalendarOutput {
    assertSchema(value, { type: 'null' }, 'edit_calendar output')
  },
}

export const operationDeleteCalendar: Validators<DeleteCalendarInput, DeleteCalendarOutput> = {
  validateInput(value: unknown): asserts value is DeleteCalendarInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_calendar input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteCalendarOutput {
    assertSchema(value, { type: 'null' }, 'delete_calendar output')
  },
}

export const operationAddCalendarEvent: Validators<AddCalendarEventInput, AddCalendarEventOutput> =
  {
    validateInput(value: unknown): asserts value is AddCalendarEventInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            organizer: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              default: null,
              title: 'Organizer',
            },
            calendar_ids: {
              anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
              default: null,
              title: 'Calendar Ids',
            },
            status: { default: 'Confirmed', title: 'Status', type: 'string' },
            draft: { default: false, title: 'Draft', type: 'boolean' },
            title: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Title' },
            start: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Start' },
            duration: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              default: null,
              title: 'Duration',
            },
            time_zone: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              default: null,
              title: 'Time Zone',
            },
            recurrence_rule: {
              anyOf: [{ additionalProperties: true, type: 'object' }, { type: 'null' }],
              default: null,
              title: 'Recurrence Rule',
            },
            show_without_time: { default: false, title: 'Show Without Time', type: 'boolean' },
            privacy: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              default: null,
              title: 'Privacy',
            },
            free_busy_status: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              default: null,
              title: 'Free Busy Status',
            },
            description: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              default: null,
              title: 'Description',
            },
            locations: {
              anyOf: [
                { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                { type: 'null' },
              ],
              default: null,
              title: 'Locations',
            },
            links: {
              anyOf: [
                { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                { type: 'null' },
              ],
              default: null,
              title: 'Links',
            },
            participants: {
              anyOf: [
                { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                { type: 'null' },
              ],
              default: null,
              title: 'Participants',
            },
            alerts: {
              anyOf: [
                { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                { type: 'null' },
              ],
              default: null,
              title: 'Alerts',
            },
            use_default_alerts: { default: false, title: 'Use Default Alerts', type: 'boolean' },
            account: { title: 'Account', type: 'string' },
            send_scheduling_messages: {
              default: false,
              title: 'Send Scheduling Messages',
              type: 'boolean',
            },
          },
          required: ['account'],
          additionalProperties: false,
          $defs: {},
        },
        'add_calendar_event input',
      )
    },
    validateOutput(value: unknown): asserts value is AddCalendarEventOutput {
      assertSchema(value, { type: 'string' }, 'add_calendar_event output')
    },
  }

export const operationUpdateCalendarEvent: Validators<
  UpdateCalendarEventInput,
  UpdateCalendarEventOutput
> = {
  validateInput(value: unknown): asserts value is UpdateCalendarEventInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          organizer: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Organizer',
          },
          calendar_ids: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            default: null,
            title: 'Calendar Ids',
          },
          status: { default: 'Confirmed', title: 'Status', type: 'string' },
          draft: { default: false, title: 'Draft', type: 'boolean' },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Title' },
          start: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Start' },
          duration: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Duration',
          },
          time_zone: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Time Zone',
          },
          recurrence_rule: {
            anyOf: [{ additionalProperties: true, type: 'object' }, { type: 'null' }],
            default: null,
            title: 'Recurrence Rule',
          },
          show_without_time: { default: false, title: 'Show Without Time', type: 'boolean' },
          privacy: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Privacy',
          },
          free_busy_status: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Free Busy Status',
          },
          description: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Description',
          },
          locations: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Locations',
          },
          links: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Links',
          },
          participants: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Participants',
          },
          alerts: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Alerts',
          },
          use_default_alerts: { default: false, title: 'Use Default Alerts', type: 'boolean' },
          account: { title: 'Account', type: 'string' },
          send_scheduling_messages: {
            default: false,
            title: 'Send Scheduling Messages',
            type: 'boolean',
          },
          id: { title: 'Id', type: 'string' },
          uid: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Uid' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_calendar_event input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateCalendarEventOutput {
    assertSchema(value, { type: 'null' }, 'update_calendar_event output')
  },
}

export const operationUpdateCalendarEventInstance: Validators<
  UpdateCalendarEventInstanceInput,
  UpdateCalendarEventInstanceOutput
> = {
  validateInput(value: unknown): asserts value is UpdateCalendarEventInstanceInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          master_id: { title: 'Master Id', type: 'string' },
          recurrence_id: { title: 'Recurrence Id', type: 'string' },
          patch: { additionalProperties: true, title: 'Patch', type: 'object' },
          send_scheduling_messages: {
            default: false,
            title: 'Send Scheduling Messages',
            type: 'boolean',
          },
        },
        required: ['account', 'master_id', 'recurrence_id', 'patch'],
        additionalProperties: false,
        $defs: {},
      },
      'update_calendar_event_instance input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateCalendarEventInstanceOutput {
    assertSchema(value, { type: 'null' }, 'update_calendar_event_instance output')
  },
}

export const operationDeleteCalendarEvents: Validators<
  DeleteCalendarEventsInput,
  DeleteCalendarEventsOutput
> = {
  validateInput(value: unknown): asserts value is DeleteCalendarEventsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          send_scheduling_messages: {
            default: false,
            title: 'Send Scheduling Messages',
            type: 'boolean',
          },
        },
        required: ['account', 'ids'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_calendar_events input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteCalendarEventsOutput {
    assertSchema(value, { type: 'null' }, 'delete_calendar_events output')
  },
}

export const operationDeleteCalendarEventInstance: Validators<
  DeleteCalendarEventInstanceInput,
  DeleteCalendarEventInstanceOutput
> = {
  validateInput(value: unknown): asserts value is DeleteCalendarEventInstanceInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          master_id: { title: 'Master Id', type: 'string' },
          recurrence_id: { title: 'Recurrence Id', type: 'string' },
          send_scheduling_messages: {
            default: false,
            title: 'Send Scheduling Messages',
            type: 'boolean',
          },
        },
        required: ['account', 'master_id', 'recurrence_id'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_calendar_event_instance input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteCalendarEventInstanceOutput {
    assertSchema(value, { type: 'null' }, 'delete_calendar_event_instance output')
  },
}

export const operationSplitCalendarEventSeries: Validators<
  SplitCalendarEventSeriesInput,
  SplitCalendarEventSeriesOutput
> = {
  validateInput(value: unknown): asserts value is SplitCalendarEventSeriesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          organizer: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Organizer',
          },
          calendar_ids: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            default: null,
            title: 'Calendar Ids',
          },
          status: { default: 'Confirmed', title: 'Status', type: 'string' },
          draft: { default: false, title: 'Draft', type: 'boolean' },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Title' },
          start: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title: 'Start' },
          duration: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Duration',
          },
          time_zone: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Time Zone',
          },
          recurrence_rule: {
            anyOf: [{ additionalProperties: true, type: 'object' }, { type: 'null' }],
            default: null,
            title: 'Recurrence Rule',
          },
          show_without_time: { default: false, title: 'Show Without Time', type: 'boolean' },
          privacy: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Privacy',
          },
          free_busy_status: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Free Busy Status',
          },
          description: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
            title: 'Description',
          },
          locations: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Locations',
          },
          links: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Links',
          },
          participants: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Participants',
          },
          alerts: {
            anyOf: [
              { items: { additionalProperties: true, type: 'object' }, type: 'array' },
              { type: 'null' },
            ],
            default: null,
            title: 'Alerts',
          },
          use_default_alerts: { default: false, title: 'Use Default Alerts', type: 'boolean' },
          account: { title: 'Account', type: 'string' },
          send_scheduling_messages: {
            default: false,
            title: 'Send Scheduling Messages',
            type: 'boolean',
          },
          master_id: { title: 'Master Id', type: 'string' },
          recurrence_id: { title: 'Recurrence Id', type: 'string' },
        },
        required: ['account', 'master_id', 'recurrence_id'],
        additionalProperties: false,
        $defs: {},
      },
      'split_calendar_event_series input',
    )
  },
  validateOutput(value: unknown): asserts value is SplitCalendarEventSeriesOutput {
    assertSchema(value, { type: 'string' }, 'split_calendar_event_series output')
  },
}

export const operationDeleteCalendarEventSeriesFrom: Validators<
  DeleteCalendarEventSeriesFromInput,
  DeleteCalendarEventSeriesFromOutput
> = {
  validateInput(value: unknown): asserts value is DeleteCalendarEventSeriesFromInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          master_id: { title: 'Master Id', type: 'string' },
          recurrence_id: { title: 'Recurrence Id', type: 'string' },
          send_scheduling_messages: {
            default: false,
            title: 'Send Scheduling Messages',
            type: 'boolean',
          },
        },
        required: ['account', 'master_id', 'recurrence_id'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_calendar_event_series_from input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteCalendarEventSeriesFromOutput {
    assertSchema(value, { type: 'null' }, 'delete_calendar_event_series_from output')
  },
}

export const operationRsvpCalendarEvent: Validators<
  RsvpCalendarEventInput,
  RsvpCalendarEventOutput
> = {
  validateInput(value: unknown): asserts value is RsvpCalendarEventInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          response: { title: 'Response', type: 'string' },
          recurrence_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Recurrence Id' },
        },
        required: ['account', 'id', 'response'],
        additionalProperties: false,
        $defs: {},
      },
      'rsvp_calendar_event input',
    )
  },
  validateOutput(value: unknown): asserts value is RsvpCalendarEventOutput {
    assertSchema(value, { type: 'null' }, 'rsvp_calendar_event output')
  },
}

export const operationGetInviteDetails: Validators<GetInviteDetailsInput, GetInviteDetailsOutput> =
  {
    validateInput(value: unknown): asserts value is GetInviteDetailsInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            account: { title: 'Account', type: 'string' },
            blob_id: { title: 'Blob Id', type: 'string' },
          },
          required: ['account', 'blob_id'],
          additionalProperties: false,
          $defs: {},
        },
        'get_invite_details input',
      )
    },
    validateOutput(value: unknown): asserts value is GetInviteDetailsOutput {
      assertSchema(
        value,
        {
          $defs: {
            CalendarEvent: {
              properties: {
                name: { title: 'Name', type: 'string' },
                account: { title: 'Account', type: 'string' },
                id: { title: 'Id', type: 'string' },
                uid: { title: 'Uid', type: 'string' },
                title: { title: 'Title', type: 'string' },
                start: { title: 'Start', type: 'string' },
                duration: { title: 'Duration', type: 'string' },
                time_zone: { title: 'Time Zone', type: 'string' },
                status: { title: 'Status', type: 'string' },
                description: { title: 'Description', type: 'string' },
                show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
                recurrence_id: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Recurrence Id',
                },
                recurrence_rule: {
                  anyOf: [
                    { type: 'string' },
                    { additionalProperties: true, type: 'object' },
                    { type: 'null' },
                  ],
                  title: 'Recurrence Rule',
                },
                organizer: { title: 'Organizer', type: 'string' },
                calendars: {
                  items: { $ref: '#/$defs/EventCalendar' },
                  title: 'Calendars',
                  type: 'array',
                },
                created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
                draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
                recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
                privacy: { title: 'Privacy', type: 'string' },
                free_busy_status: { title: 'Free Busy Status', type: 'string' },
                locations: {
                  items: { additionalProperties: true, type: 'object' },
                  title: 'Locations',
                  type: 'array',
                },
                alerts: {
                  items: { additionalProperties: true, type: 'object' },
                  title: 'Alerts',
                  type: 'array',
                },
                use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
                created_utc: { title: 'Created Utc', type: 'string' },
                updated_utc: { title: 'Updated Utc', type: 'string' },
                origin: { title: 'Origin', type: 'boolean' },
                may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
                may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
                hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
                creation: { title: 'Creation', type: 'string' },
                modified: { title: 'Modified', type: 'string' },
                sequence: { title: 'Sequence', type: 'integer' },
                master_id: { title: 'Master Id', type: 'string' },
                master_start: { title: 'Master Start', type: 'string' },
                master_duration: { title: 'Master Duration', type: 'string' },
                links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
                participants: {
                  items: { $ref: '#/$defs/Participant' },
                  title: 'Participants',
                  type: 'array',
                },
                conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
              },
              required: [
                'name',
                'account',
                'id',
                'uid',
                'title',
                'start',
                'duration',
                'time_zone',
                'status',
                'description',
                'show_without_time',
                'recurrence_id',
                'recurrence_rule',
                'organizer',
                'calendars',
                'created',
                'draft',
                'recurrence_id_time_zone',
                'privacy',
                'free_busy_status',
                'locations',
                'alerts',
                'use_default_alerts',
                'created_utc',
                'updated_utc',
                'origin',
                'may_invite_self',
                'may_invite_others',
                'hide_attendees',
                'creation',
                'modified',
                'sequence',
                'links',
                'participants',
              ],
              title: 'CalendarEvent',
              type: 'object',
            },
            Conferencing: {
              properties: {
                meeting_id: { title: 'Meeting Id', type: 'string' },
                url: { title: 'Url', type: 'string' },
              },
              required: ['meeting_id', 'url'],
              title: 'Conferencing',
              type: 'object',
            },
            EventCalendar: {
              properties: {
                calendar: { title: 'Calendar', type: 'string' },
                calendar_id: { title: 'Calendar Id', type: 'string' },
                calendar_name: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Calendar Name',
                },
                color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
              },
              required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
              title: 'EventCalendar',
              type: 'object',
            },
            EventLink: {
              properties: {
                uid: { title: 'Uid', type: 'string' },
                href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
                content_type: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Content Type',
                },
              },
              required: ['uid', 'href', 'content_type'],
              title: 'EventLink',
              type: 'object',
            },
            InviteDetails: {
              properties: {
                uid: { title: 'Uid', type: 'string' },
                method: { title: 'Method', type: 'string' },
                exists: { title: 'Exists', type: 'boolean' },
                event: { $ref: '#/$defs/CalendarEvent' },
                participant: { anyOf: [{ $ref: '#/$defs/ViewerParticipant' }, { type: 'null' }] },
              },
              required: ['uid', 'method', 'exists', 'event', 'participant'],
              title: 'InviteDetails',
              type: 'object',
            },
            Participant: {
              properties: {
                uid: { title: 'Uid', type: 'string' },
                roles: {
                  additionalProperties: { type: 'boolean' },
                  title: 'Roles',
                  type: 'object',
                },
                kind: { title: 'Kind', type: 'string' },
                _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
                email: { title: 'Email', type: 'string' },
                schedule_id: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Schedule Id',
                },
                send_to: {
                  anyOf: [
                    { additionalProperties: { type: 'string' }, type: 'object' },
                    { type: 'null' },
                  ],
                  title: 'Send To',
                },
                participation_status: { title: 'Participation Status', type: 'string' },
                expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
                description: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Description',
                },
                comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
                schedule_agent: { title: 'Schedule Agent', type: 'string' },
                member_of: {
                  additionalProperties: { type: 'boolean' },
                  title: 'Member Of',
                  type: 'object',
                },
                user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              },
              required: [
                'uid',
                'roles',
                'kind',
                '_name',
                'email',
                'schedule_id',
                'send_to',
                'participation_status',
                'expect_reply',
                'description',
                'comment',
                'schedule_agent',
                'member_of',
              ],
              title: 'Participant',
              type: 'object',
            },
            ViewerParticipant: {
              properties: {
                uid: { title: 'Uid', type: 'string' },
                email: { title: 'Email', type: 'string' },
                status: { title: 'Status', type: 'string' },
              },
              required: ['uid', 'email', 'status'],
              title: 'ViewerParticipant',
              type: 'object',
            },
          },
          anyOf: [{ $ref: '#/$defs/InviteDetails' }, { type: 'null' }],
        },
        'get_invite_details output',
      )
    },
  }

export const operationAddInviteToCalendar: Validators<
  AddInviteToCalendarInput,
  AddInviteToCalendarOutput
> = {
  validateInput(value: unknown): asserts value is AddInviteToCalendarInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          blob_id: { title: 'Blob Id', type: 'string' },
        },
        required: ['account', 'blob_id'],
        additionalProperties: false,
        $defs: {},
      },
      'add_invite_to_calendar input',
    )
  },
  validateOutput(value: unknown): asserts value is AddInviteToCalendarOutput {
    assertSchema(
      value,
      {
        $defs: {
          Conferencing: {
            properties: {
              meeting_id: { title: 'Meeting Id', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['meeting_id', 'url'],
            title: 'Conferencing',
            type: 'object',
          },
          EventCalendar: {
            properties: {
              calendar: { title: 'Calendar', type: 'string' },
              calendar_id: { title: 'Calendar Id', type: 'string' },
              calendar_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Calendar Name',
              },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
            },
            required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
            title: 'EventCalendar',
            type: 'object',
          },
          EventLink: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
              content_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Content Type',
              },
            },
            required: ['uid', 'href', 'content_type'],
            title: 'EventLink',
            type: 'object',
          },
          Participant: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              roles: { additionalProperties: { type: 'boolean' }, title: 'Roles', type: 'object' },
              kind: { title: 'Kind', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              schedule_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Schedule Id' },
              send_to: {
                anyOf: [
                  { additionalProperties: { type: 'string' }, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Send To',
              },
              participation_status: { title: 'Participation Status', type: 'string' },
              expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
              schedule_agent: { title: 'Schedule Agent', type: 'string' },
              member_of: {
                additionalProperties: { type: 'boolean' },
                title: 'Member Of',
                type: 'object',
              },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'uid',
              'roles',
              'kind',
              '_name',
              'email',
              'schedule_id',
              'send_to',
              'participation_status',
              'expect_reply',
              'description',
              'comment',
              'schedule_agent',
              'member_of',
            ],
            title: 'Participant',
            type: 'object',
          },
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          uid: { title: 'Uid', type: 'string' },
          title: { title: 'Title', type: 'string' },
          start: { title: 'Start', type: 'string' },
          duration: { title: 'Duration', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
          status: { title: 'Status', type: 'string' },
          description: { title: 'Description', type: 'string' },
          show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
          recurrence_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Recurrence Id' },
          recurrence_rule: {
            anyOf: [
              { type: 'string' },
              { additionalProperties: true, type: 'object' },
              { type: 'null' },
            ],
            title: 'Recurrence Rule',
          },
          organizer: { title: 'Organizer', type: 'string' },
          calendars: {
            items: { $ref: '#/$defs/EventCalendar' },
            title: 'Calendars',
            type: 'array',
          },
          created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
          draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
          recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
          privacy: { title: 'Privacy', type: 'string' },
          free_busy_status: { title: 'Free Busy Status', type: 'string' },
          locations: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Locations',
            type: 'array',
          },
          alerts: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Alerts',
            type: 'array',
          },
          use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
          created_utc: { title: 'Created Utc', type: 'string' },
          updated_utc: { title: 'Updated Utc', type: 'string' },
          origin: { title: 'Origin', type: 'boolean' },
          may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
          may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
          hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
          creation: { title: 'Creation', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
          sequence: { title: 'Sequence', type: 'integer' },
          master_id: { title: 'Master Id', type: 'string' },
          master_start: { title: 'Master Start', type: 'string' },
          master_duration: { title: 'Master Duration', type: 'string' },
          links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
          participants: {
            items: { $ref: '#/$defs/Participant' },
            title: 'Participants',
            type: 'array',
          },
          conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
        },
        required: [
          'name',
          'account',
          'id',
          'uid',
          'title',
          'start',
          'duration',
          'time_zone',
          'status',
          'description',
          'show_without_time',
          'recurrence_id',
          'recurrence_rule',
          'organizer',
          'calendars',
          'created',
          'draft',
          'recurrence_id_time_zone',
          'privacy',
          'free_busy_status',
          'locations',
          'alerts',
          'use_default_alerts',
          'created_utc',
          'updated_utc',
          'origin',
          'may_invite_self',
          'may_invite_others',
          'hide_attendees',
          'creation',
          'modified',
          'sequence',
          'links',
          'participants',
        ],
        title: 'CalendarEvent',
        type: 'object',
      },
      'add_invite_to_calendar output',
    )
  },
}

export const operationRsvpToInvite: Validators<RsvpToInviteInput, RsvpToInviteOutput> = {
  validateInput(value: unknown): asserts value is RsvpToInviteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          blob_id: { title: 'Blob Id', type: 'string' },
          response: {
            enum: ['accepted', 'tentative', 'declined'],
            title: 'Response',
            type: 'string',
          },
        },
        required: ['account', 'blob_id', 'response'],
        additionalProperties: false,
        $defs: {},
      },
      'rsvp_to_invite input',
    )
  },
  validateOutput(value: unknown): asserts value is RsvpToInviteOutput {
    assertSchema(
      value,
      {
        $defs: {
          Conferencing: {
            properties: {
              meeting_id: { title: 'Meeting Id', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['meeting_id', 'url'],
            title: 'Conferencing',
            type: 'object',
          },
          EventCalendar: {
            properties: {
              calendar: { title: 'Calendar', type: 'string' },
              calendar_id: { title: 'Calendar Id', type: 'string' },
              calendar_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Calendar Name',
              },
              color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
            },
            required: ['calendar', 'calendar_id', 'calendar_name', 'color'],
            title: 'EventCalendar',
            type: 'object',
          },
          EventLink: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              href: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Href' },
              content_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Content Type',
              },
            },
            required: ['uid', 'href', 'content_type'],
            title: 'EventLink',
            type: 'object',
          },
          Participant: {
            properties: {
              uid: { title: 'Uid', type: 'string' },
              roles: { additionalProperties: { type: 'boolean' }, title: 'Roles', type: 'object' },
              kind: { title: 'Kind', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              schedule_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Schedule Id' },
              send_to: {
                anyOf: [
                  { additionalProperties: { type: 'string' }, type: 'object' },
                  { type: 'null' },
                ],
                title: 'Send To',
              },
              participation_status: { title: 'Participation Status', type: 'string' },
              expect_reply: { enum: [0, 1], title: 'Expect Reply', type: 'integer' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              comment: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Comment' },
              schedule_agent: { title: 'Schedule Agent', type: 'string' },
              member_of: {
                additionalProperties: { type: 'boolean' },
                title: 'Member Of',
                type: 'object',
              },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'uid',
              'roles',
              'kind',
              '_name',
              'email',
              'schedule_id',
              'send_to',
              'participation_status',
              'expect_reply',
              'description',
              'comment',
              'schedule_agent',
              'member_of',
            ],
            title: 'Participant',
            type: 'object',
          },
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          uid: { title: 'Uid', type: 'string' },
          title: { title: 'Title', type: 'string' },
          start: { title: 'Start', type: 'string' },
          duration: { title: 'Duration', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
          status: { title: 'Status', type: 'string' },
          description: { title: 'Description', type: 'string' },
          show_without_time: { enum: [0, 1], title: 'Show Without Time', type: 'integer' },
          recurrence_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Recurrence Id' },
          recurrence_rule: {
            anyOf: [
              { type: 'string' },
              { additionalProperties: true, type: 'object' },
              { type: 'null' },
            ],
            title: 'Recurrence Rule',
          },
          organizer: { title: 'Organizer', type: 'string' },
          calendars: {
            items: { $ref: '#/$defs/EventCalendar' },
            title: 'Calendars',
            type: 'array',
          },
          created: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created' },
          draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
          recurrence_id_time_zone: { title: 'Recurrence Id Time Zone', type: 'string' },
          privacy: { title: 'Privacy', type: 'string' },
          free_busy_status: { title: 'Free Busy Status', type: 'string' },
          locations: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Locations',
            type: 'array',
          },
          alerts: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Alerts',
            type: 'array',
          },
          use_default_alerts: { enum: [0, 1], title: 'Use Default Alerts', type: 'integer' },
          created_utc: { title: 'Created Utc', type: 'string' },
          updated_utc: { title: 'Updated Utc', type: 'string' },
          origin: { title: 'Origin', type: 'boolean' },
          may_invite_self: { enum: [0, 1], title: 'May Invite Self', type: 'integer' },
          may_invite_others: { enum: [0, 1], title: 'May Invite Others', type: 'integer' },
          hide_attendees: { enum: [0, 1], title: 'Hide Attendees', type: 'integer' },
          creation: { title: 'Creation', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
          sequence: { title: 'Sequence', type: 'integer' },
          master_id: { title: 'Master Id', type: 'string' },
          master_start: { title: 'Master Start', type: 'string' },
          master_duration: { title: 'Master Duration', type: 'string' },
          links: { items: { $ref: '#/$defs/EventLink' }, title: 'Links', type: 'array' },
          participants: {
            items: { $ref: '#/$defs/Participant' },
            title: 'Participants',
            type: 'array',
          },
          conferencing: { anyOf: [{ $ref: '#/$defs/Conferencing' }, { type: 'null' }] },
        },
        required: [
          'name',
          'account',
          'id',
          'uid',
          'title',
          'start',
          'duration',
          'time_zone',
          'status',
          'description',
          'show_without_time',
          'recurrence_id',
          'recurrence_rule',
          'organizer',
          'calendars',
          'created',
          'draft',
          'recurrence_id_time_zone',
          'privacy',
          'free_busy_status',
          'locations',
          'alerts',
          'use_default_alerts',
          'created_utc',
          'updated_utc',
          'origin',
          'may_invite_self',
          'may_invite_others',
          'hide_attendees',
          'creation',
          'modified',
          'sequence',
          'links',
          'participants',
        ],
        title: 'CalendarEvent',
        type: 'object',
      },
      'rsvp_to_invite output',
    )
  },
}
