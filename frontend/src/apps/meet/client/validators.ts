// Generated from src/apps/meet/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  ApproveAllJoinRequestsInput,
  ApproveAllJoinRequestsOutput,
  ApproveJoinRequestInput,
  ApproveJoinRequestOutput,
  BanGuestInput,
  BanGuestOutput,
  CalendarMeetingInput,
  CalendarMeetingOutput,
  E2eeDeviceInput,
  E2eeDeviceOutput,
  EnableE2eeInput,
  EnableE2eeOutput,
  GetWaitingRoomDetailsInput,
  GetWaitingRoomDetailsOutput,
  GuestRoomConnectionInput,
  GuestRoomConnectionOutput,
  GuestRoomJoinInput,
  GuestRoomJoinOutput,
  GuestRoomTokenInput,
  GuestRoomTokenOutput,
  PromoteToCohostInput,
  PromoteToCohostOutput,
  RecentRoomsInput,
  RecentRoomsOutput,
  RecordingListInput,
  RecordingListOutput,
  RecordingPreflightInput,
  RecordingPreflightOutput,
  RecordingStartInput,
  RecordingStartOutput,
  RecordingStateInput,
  RecordingStateOutput,
  RecordingStopInput,
  RecordingStopOutput,
  RejectJoinRequestInput,
  RejectJoinRequestOutput,
  RoomAccessInput,
  RoomAccessOutput,
  RoomConnectionInput,
  RoomConnectionOutput,
  RoomDocumentInput,
  RoomDocumentOutput,
  RoomJoinInput,
  RoomJoinOutput,
  RoomLinkInput,
  RoomLinkOutput,
  RoomPresenceTokenInput,
  RoomPresenceTokenOutput,
  RoomPreviewInput,
  RoomPreviewOutput,
  RoomSearchInput,
  RoomSearchOutput,
  RoomsPostInput,
  RoomsPostOutput,
  RoomTokenInput,
  RoomTokenOutput,
  ScheduledMeetingsPostInput,
  ScheduledMeetingsPostOutput,
  UpdateSettingsInput,
  UpdateSettingsOutput,
} from './generated'

export const operationRoomsPost: Validators<RoomsPostInput, RoomsPostOutput> = {
  validateInput(value: unknown): asserts value is RoomsPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { type: { enum: ['open', 'restricted'], title: 'Type', type: 'string' } },
        required: ['type'],
        additionalProperties: false,
        $defs: {},
      },
      'rooms_post input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomsPostOutput {
    assertSchema(
      value,
      {
        properties: {
          code: { title: 'Code', type: 'string' },
          url: { title: 'Url', type: 'string' },
        },
        required: ['code', 'url'],
        title: 'Room',
        type: 'object',
      },
      'rooms_post output',
    )
  },
}

export const operationScheduledMeetingsPost: Validators<
  ScheduledMeetingsPostInput,
  ScheduledMeetingsPostOutput
> = {
  validateInput(value: unknown): asserts value is ScheduledMeetingsPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          title: { title: 'Title', type: 'string' },
          start: { title: 'Start', type: 'string' },
          end: { title: 'End', type: 'string' },
          attendees: { items: { $ref: '#/$defs/Attendee' }, title: 'Attendees', type: 'array' },
        },
        required: ['title', 'start', 'end', 'attendees'],
        additionalProperties: false,
        $defs: {
          Attendee: {
            properties: {
              email: { title: 'Email', type: 'string' },
              name: { title: 'Name', type: 'string' },
            },
            required: ['email'],
            title: 'Attendee',
            type: 'object',
          },
        },
      },
      'scheduled_meetings_post input',
    )
  },
  validateOutput(value: unknown): asserts value is ScheduledMeetingsPostOutput {
    assertSchema(
      value,
      {
        $defs: {
          Room: {
            properties: {
              code: { title: 'Code', type: 'string' },
              url: { title: 'Url', type: 'string' },
            },
            required: ['code', 'url'],
            title: 'Room',
            type: 'object',
          },
        },
        properties: {
          meeting: { $ref: '#/$defs/Room' },
          calendar_event_id: { title: 'Calendar Event Id', type: 'string' },
        },
        required: ['meeting', 'calendar_event_id'],
        title: 'ScheduledMeeting',
        type: 'object',
      },
      'scheduled_meetings_post output',
    )
  },
}

export const operationRoomPreview: Validators<RoomPreviewInput, RoomPreviewOutput> = {
  validateInput(value: unknown): asserts value is RoomPreviewInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'room_preview input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomPreviewOutput {
    assertSchema(
      value,
      {
        properties: { title: { title: 'Title', type: 'string' } },
        required: ['title'],
        title: 'Preview',
        type: 'object',
      },
      'room_preview output',
    )
  },
}

export const operationRoomAccess: Validators<RoomAccessInput, RoomAccessOutput> = {
  validateInput(value: unknown): asserts value is RoomAccessInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'room_access input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomAccessOutput {
    assertSchema(
      value,
      {
        properties: {
          allow_guest: { title: 'Allow Guest', type: 'boolean' },
          host_only_chat: { title: 'Host Only Chat', type: 'boolean' },
        },
        required: ['allow_guest'],
        title: 'Access',
        type: 'object',
      },
      'room_access output',
    )
  },
}

export const operationRoomConnection: Validators<RoomConnectionInput, RoomConnectionOutput> = {
  validateInput(value: unknown): asserts value is RoomConnectionInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'room_connection input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomConnectionOutput {
    assertSchema(value, { additionalProperties: true, type: 'object' }, 'room_connection output')
  },
}

export const operationRoomPresenceToken: Validators<
  RoomPresenceTokenInput,
  RoomPresenceTokenOutput
> = {
  validateInput(value: unknown): asserts value is RoomPresenceTokenInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'room_presence_token input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomPresenceTokenOutput {
    assertSchema(
      value,
      {
        properties: {
          restricted_preview: { title: 'Restricted Preview', type: 'boolean' },
          auth_token: { title: 'Auth Token', type: 'string' },
          sfu_url: { title: 'Sfu Url', type: 'string' },
          sfu_port: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Sfu Port' },
          expires_in: { title: 'Expires In', type: 'integer' },
        },
        title: 'PresenceToken',
        type: 'object',
      },
      'room_presence_token output',
    )
  },
}

export const operationRoomJoin: Validators<RoomJoinInput, RoomJoinOutput> = {
  validateInput(value: unknown): asserts value is RoomJoinInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'room_join input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomJoinOutput {
    assertSchema(value, { additionalProperties: true, type: 'object' }, 'room_join output')
  },
}

export const operationGuestRoomJoin: Validators<GuestRoomJoinInput, GuestRoomJoinOutput> = {
  validateInput(value: unknown): asserts value is GuestRoomJoinInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          guest_name: { title: 'Guest Name', type: 'string' },
          guest_id: { title: 'Guest Id', type: 'string' },
          guest_session_token: { title: 'Guest Session Token', type: 'string' },
        },
        required: ['meeting_id', 'guest_name'],
        additionalProperties: false,
        $defs: {},
      },
      'guest_room_join input',
    )
  },
  validateOutput(value: unknown): asserts value is GuestRoomJoinOutput {
    assertSchema(value, { additionalProperties: true, type: 'object' }, 'guest_room_join output')
  },
}

export const operationGuestRoomConnection: Validators<
  GuestRoomConnectionInput,
  GuestRoomConnectionOutput
> = {
  validateInput(value: unknown): asserts value is GuestRoomConnectionInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          guest_id: { title: 'Guest Id', type: 'string' },
          guest_session_token: { title: 'Guest Session Token', type: 'string' },
        },
        required: ['meeting_id', 'guest_id', 'guest_session_token'],
        additionalProperties: false,
        $defs: {},
      },
      'guest_room_connection input',
    )
  },
  validateOutput(value: unknown): asserts value is GuestRoomConnectionOutput {
    assertSchema(
      value,
      { additionalProperties: true, type: 'object' },
      'guest_room_connection output',
    )
  },
}

export const operationGuestRoomToken: Validators<GuestRoomTokenInput, GuestRoomTokenOutput> = {
  validateInput(value: unknown): asserts value is GuestRoomTokenInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          guest_id: { title: 'Guest Id', type: 'string' },
          guest_session_token: { title: 'Guest Session Token', type: 'string' },
        },
        required: ['meeting_id', 'guest_id', 'guest_session_token'],
        additionalProperties: false,
        $defs: {},
      },
      'guest_room_token input',
    )
  },
  validateOutput(value: unknown): asserts value is GuestRoomTokenOutput {
    assertSchema(value, { additionalProperties: true, type: 'object' }, 'guest_room_token output')
  },
}

export const operationRoomToken: Validators<RoomTokenInput, RoomTokenOutput> = {
  validateInput(value: unknown): asserts value is RoomTokenInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'room_token input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomTokenOutput {
    assertSchema(value, { additionalProperties: true, type: 'object' }, 'room_token output')
  },
}

export const operationE2eeDevice: Validators<E2eeDeviceInput, E2eeDeviceOutput> = {
  validateInput(value: unknown): asserts value is E2eeDeviceInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          device_id: { title: 'Device Id', type: 'string' },
          ed25519_public_key: { title: 'Ed25519 Public Key', type: 'string' },
        },
        required: ['device_id', 'ed25519_public_key'],
        additionalProperties: false,
        $defs: {},
      },
      'e2ee_device input',
    )
  },
  validateOutput(value: unknown): asserts value is E2eeDeviceOutput {
    assertSchema(value, { additionalProperties: true, type: 'object' }, 'e2ee_device output')
  },
}

export const operationRecordingState: Validators<RecordingStateInput, RecordingStateOutput> = {
  validateInput(value: unknown): asserts value is RecordingStateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'recording_state input',
    )
  },
  validateOutput(value: unknown): asserts value is RecordingStateOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecordingState: {
            properties: {
              name: { title: 'Name', type: 'string' },
              status: {
                enum: [
                  'Pending',
                  'Starting',
                  'Recording',
                  'Interrupted',
                  'Stopping',
                  'Processing',
                  'Ready',
                  'Partial',
                  'Failed',
                  'Cancelled',
                ],
                title: 'Status',
                type: 'string',
              },
              state_revision: { title: 'State Revision', type: 'integer' },
              started_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Started At' },
              capture_started_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Capture Started At',
              },
              interruption_id: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Interruption Id',
              },
              interrupted_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Interrupted At',
              },
              interruption_deadline: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Interruption Deadline',
              },
            },
            required: ['name', 'status', 'state_revision'],
            title: 'RecordingState',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/RecordingState' }, { type: 'null' }],
      },
      'recording_state output',
    )
  },
}

export const operationRecordingPreflight: Validators<
  RecordingPreflightInput,
  RecordingPreflightOutput
> = {
  validateInput(value: unknown): asserts value is RecordingPreflightInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'recording_preflight input',
    )
  },
  validateOutput(value: unknown): asserts value is RecordingPreflightOutput {
    assertSchema(
      value,
      {
        properties: {
          eligible: { title: 'Eligible', type: 'boolean' },
          global_enabled: { title: 'Global Enabled', type: 'boolean' },
          e2ee_conflict: { title: 'E2Ee Conflict', type: 'boolean' },
          storage_available: { title: 'Storage Available', type: 'boolean' },
          recorder_available: { title: 'Recorder Available', type: 'boolean' },
          estimated_seconds: { title: 'Estimated Seconds', type: 'integer' },
          estimated_bytes: { title: 'Estimated Bytes', type: 'integer' },
          free_bytes: { title: 'Free Bytes', type: 'integer' },
          budget_bytes: { title: 'Budget Bytes', type: 'integer' },
          budget_seconds: { title: 'Budget Seconds', type: 'integer' },
          maximum_seconds: { title: 'Maximum Seconds', type: 'integer' },
        },
        required: [
          'eligible',
          'global_enabled',
          'e2ee_conflict',
          'storage_available',
          'recorder_available',
          'estimated_seconds',
          'estimated_bytes',
          'free_bytes',
          'budget_bytes',
          'budget_seconds',
          'maximum_seconds',
        ],
        title: 'RecordingPreflight',
        type: 'object',
      },
      'recording_preflight output',
    )
  },
}

export const operationRecordingStart: Validators<RecordingStartInput, RecordingStartOutput> = {
  validateInput(value: unknown): asserts value is RecordingStartInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          request_id: { title: 'Request Id', type: 'string' },
        },
        required: ['meeting_id', 'request_id'],
        additionalProperties: false,
        $defs: {},
      },
      'recording_start input',
    )
  },
  validateOutput(value: unknown): asserts value is RecordingStartOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecordingCommand: {
            properties: {
              name: { title: 'Name', type: 'string' },
              status: {
                enum: [
                  'Pending',
                  'Starting',
                  'Recording',
                  'Interrupted',
                  'Stopping',
                  'Processing',
                  'Ready',
                  'Partial',
                  'Failed',
                  'Cancelled',
                ],
                title: 'Status',
                type: 'string',
              },
              grant_delivered: { title: 'Grant Delivered', type: 'boolean' },
            },
            required: ['name', 'status'],
            title: 'RecordingCommand',
            type: 'object',
          },
          RejectedRecording: {
            properties: { status: { const: 'Rejected', title: 'Status', type: 'string' } },
            required: ['status'],
            title: 'RejectedRecording',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/RecordingCommand' }, { $ref: '#/$defs/RejectedRecording' }],
      },
      'recording_start output',
    )
  },
}

export const operationRecordingStop: Validators<RecordingStopInput, RecordingStopOutput> = {
  validateInput(value: unknown): asserts value is RecordingStopInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { meeting_id: { title: 'Meeting Id', type: 'string' } },
        required: ['meeting_id'],
        additionalProperties: false,
        $defs: {},
      },
      'recording_stop input',
    )
  },
  validateOutput(value: unknown): asserts value is RecordingStopOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecordingCommand: {
            properties: {
              name: { title: 'Name', type: 'string' },
              status: {
                enum: [
                  'Pending',
                  'Starting',
                  'Recording',
                  'Interrupted',
                  'Stopping',
                  'Processing',
                  'Ready',
                  'Partial',
                  'Failed',
                  'Cancelled',
                ],
                title: 'Status',
                type: 'string',
              },
              grant_delivered: { title: 'Grant Delivered', type: 'boolean' },
            },
            required: ['name', 'status'],
            title: 'RecordingCommand',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/RecordingCommand' }, { type: 'null' }],
      },
      'recording_stop output',
    )
  },
}

export const operationCalendarMeeting: Validators<CalendarMeetingInput, CalendarMeetingOutput> = {
  validateInput(value: unknown): asserts value is CalendarMeetingInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          user: { title: 'User', type: 'string' },
          organizer: { title: 'Organizer', type: 'string' },
          calendar_ids: { items: { type: 'string' }, title: 'Calendar Ids', type: 'array' },
          status: { title: 'Status', type: 'string' },
          draft: { title: 'Draft', type: 'boolean' },
          title: { title: 'Title', type: 'string' },
          start: { title: 'Start', type: 'string' },
          duration: { title: 'Duration', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
          recurrence_rule: { additionalProperties: true, title: 'Recurrence Rule', type: 'object' },
          show_without_time: { title: 'Show Without Time', type: 'boolean' },
          participants: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Participants',
            type: 'array',
          },
          description: { title: 'Description', type: 'string' },
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
          free_busy_status: { title: 'Free Busy Status', type: 'string' },
          privacy: { title: 'Privacy', type: 'string' },
          use_default_alerts: { title: 'Use Default Alerts', type: 'boolean' },
          send_scheduling_messages: { title: 'Send Scheduling Messages', type: 'boolean' },
          meeting_type: { title: 'Meeting Type', type: 'string' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'calendar_meeting input',
    )
  },
  validateOutput(value: unknown): asserts value is CalendarMeetingOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          meeting_url: { title: 'Meeting Url', type: 'string' },
          event_id: { title: 'Event Id', type: 'string' },
        },
        required: ['meeting_id', 'meeting_url', 'event_id'],
        title: 'CalendarMeetingResult',
        type: 'object',
      },
      'calendar_meeting output',
    )
  },
}

export const operationRoomLink: Validators<RoomLinkInput, RoomLinkOutput> = {
  validateInput(value: unknown): asserts value is RoomLinkInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          title: { title: 'Title', type: 'string' },
          meeting_type: { title: 'Meeting Type', type: 'string' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'room_link input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomLinkOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          meeting_url: { title: 'Meeting Url', type: 'string' },
        },
        required: ['meeting_id', 'meeting_url'],
        title: 'RoomLinkResult',
        type: 'object',
      },
      'room_link output',
    )
  },
}

export const operationRecentRooms: Validators<RecentRoomsInput, RecentRoomsOutput> = {
  validateInput(value: unknown): asserts value is RecentRoomsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'recent_rooms input',
    )
  },
  validateOutput(value: unknown): asserts value is RecentRoomsOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecentRoom: {
            properties: {
              id: { title: 'Id', type: 'string' },
              title: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Title' },
              last_joined: { title: 'Last Joined', type: 'string' },
              recording: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Recording' },
            },
            required: ['id', 'title', 'last_joined', 'recording'],
            title: 'RecentRoom',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/RecentRoom' },
        type: 'array',
      },
      'recent_rooms output',
    )
  },
}

export const operationRecordingList: Validators<RecordingListInput, RecordingListOutput> = {
  validateInput(value: unknown): asserts value is RecordingListInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'recording_list input',
    )
  },
  validateOutput(value: unknown): asserts value is RecordingListOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecordingSummary: {
            properties: {
              name: { title: 'Name', type: 'string' },
              meet_room: { title: 'Meet Room', type: 'string' },
              room_title: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Room Title' },
              started_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Started At' },
              artifact: { title: 'Artifact', type: 'string' },
              artifact_duration: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
                title: 'Artifact Duration',
              },
              status: { enum: ['Ready', 'Partial'], title: 'Status', type: 'string' },
            },
            required: [
              'name',
              'meet_room',
              'room_title',
              'started_at',
              'artifact',
              'artifact_duration',
              'status',
            ],
            title: 'RecordingSummary',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/RecordingSummary' },
        type: 'array',
      },
      'recording_list output',
    )
  },
}

export const operationRoomSearch: Validators<RoomSearchInput, RoomSearchOutput> = {
  validateInput(value: unknown): asserts value is RoomSearchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { q: { title: 'Q', type: 'string' } },
        required: ['q'],
        additionalProperties: false,
        $defs: {},
      },
      'room_search input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomSearchOutput {
    assertSchema(
      value,
      {
        $defs: {
          RoomSummary: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Title' },
            },
            required: ['name', 'title'],
            title: 'RoomSummary',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/RoomSummary' },
        type: 'array',
      },
      'room_search output',
    )
  },
}

export const operationRoomDocument: Validators<RoomDocumentInput, RoomDocumentOutput> = {
  validateInput(value: unknown): asserts value is RoomDocumentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'room_document input',
    )
  },
  validateOutput(value: unknown): asserts value is RoomDocumentOutput {
    assertSchema(
      value,
      {
        $defs: {
          RoomUser: {
            properties: { user: { title: 'User', type: 'string' } },
            required: ['user'],
            title: 'RoomUser',
            type: 'object',
          },
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          owner: { title: 'Owner', type: 'string' },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Title' },
          co_hosts: { items: { $ref: '#/$defs/RoomUser' }, title: 'Co Hosts', type: 'array' },
          allow_guest: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Allow Guest',
          },
          meeting_type: { enum: ['open', 'restricted'], title: 'Meeting Type', type: 'string' },
          host_only_chat: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Host Only Chat',
          },
          e2ee_enabled: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'E2Ee Enabled',
          },
        },
        required: [
          'name',
          'owner',
          'title',
          'co_hosts',
          'allow_guest',
          'meeting_type',
          'host_only_chat',
          'e2ee_enabled',
        ],
        title: 'RoomDocument',
        type: 'object',
      },
      'room_document output',
    )
  },
}

export const operationApproveJoinRequest: Validators<
  ApproveJoinRequestInput,
  ApproveJoinRequestOutput
> = {
  validateInput(value: unknown): asserts value is ApproveJoinRequestInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { user_id: { title: 'User Id', type: 'string' }, name: { type: 'string' } },
        required: ['user_id', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'approve_join_request input',
    )
  },
  validateOutput(value: unknown): asserts value is ApproveJoinRequestOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          message: { title: 'Message', type: 'string' },
          user_id: { title: 'User Id', type: 'string' },
        },
        required: ['meeting_id', 'message'],
        title: 'CommandResult',
        type: 'object',
      },
      'approve_join_request output',
    )
  },
}

export const operationApproveAllJoinRequests: Validators<
  ApproveAllJoinRequestsInput,
  ApproveAllJoinRequestsOutput
> = {
  validateInput(value: unknown): asserts value is ApproveAllJoinRequestsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'approve_all_join_requests input',
    )
  },
  validateOutput(value: unknown): asserts value is ApproveAllJoinRequestsOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          message: { title: 'Message', type: 'string' },
          user_id: { title: 'User Id', type: 'string' },
        },
        required: ['meeting_id', 'message'],
        title: 'CommandResult',
        type: 'object',
      },
      'approve_all_join_requests output',
    )
  },
}

export const operationRejectJoinRequest: Validators<
  RejectJoinRequestInput,
  RejectJoinRequestOutput
> = {
  validateInput(value: unknown): asserts value is RejectJoinRequestInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { user_id: { title: 'User Id', type: 'string' }, name: { type: 'string' } },
        required: ['user_id', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'reject_join_request input',
    )
  },
  validateOutput(value: unknown): asserts value is RejectJoinRequestOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          message: { title: 'Message', type: 'string' },
          user_id: { title: 'User Id', type: 'string' },
        },
        required: ['meeting_id', 'message'],
        title: 'CommandResult',
        type: 'object',
      },
      'reject_join_request output',
    )
  },
}

export const operationGetWaitingRoomDetails: Validators<
  GetWaitingRoomDetailsInput,
  GetWaitingRoomDetailsOutput
> = {
  validateInput(value: unknown): asserts value is GetWaitingRoomDetailsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_waiting_room_details input',
    )
  },
  validateOutput(value: unknown): asserts value is GetWaitingRoomDetailsOutput {
    assertSchema(
      value,
      {
        $defs: {
          WaitingUser: {
            properties: {
              user_id: { title: 'User Id', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_name: { title: 'User Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              is_guest: { title: 'Is Guest', type: 'boolean' },
            },
            required: ['user_id', 'full_name', 'user_name', 'user_image', 'is_guest'],
            title: 'WaitingUser',
            type: 'object',
          },
        },
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          waiting_users: {
            items: { $ref: '#/$defs/WaitingUser' },
            title: 'Waiting Users',
            type: 'array',
          },
        },
        required: ['meeting_id', 'waiting_users'],
        title: 'WaitingRoom',
        type: 'object',
      },
      'get_waiting_room_details output',
    )
  },
}

export const operationBanGuest: Validators<BanGuestInput, BanGuestOutput> = {
  validateInput(value: unknown): asserts value is BanGuestInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { guest_id: { title: 'Guest Id', type: 'string' }, name: { type: 'string' } },
        required: ['guest_id', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'ban_guest input',
    )
  },
  validateOutput(value: unknown): asserts value is BanGuestOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          guest_id: { title: 'Guest Id', type: 'string' },
          status: { const: 'banned', title: 'Status', type: 'string' },
        },
        required: ['meeting_id', 'guest_id', 'status'],
        title: 'BanResult',
        type: 'object',
      },
      'ban_guest output',
    )
  },
}

export const operationPromoteToCohost: Validators<PromoteToCohostInput, PromoteToCohostOutput> = {
  validateInput(value: unknown): asserts value is PromoteToCohostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { user_id: { title: 'User Id', type: 'string' }, name: { type: 'string' } },
        required: ['user_id', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'promote_to_cohost input',
    )
  },
  validateOutput(value: unknown): asserts value is PromoteToCohostOutput {
    assertSchema(
      value,
      {
        properties: {
          meeting_id: { title: 'Meeting Id', type: 'string' },
          message: { title: 'Message', type: 'string' },
          user_id: { title: 'User Id', type: 'string' },
        },
        required: ['meeting_id', 'message'],
        title: 'CommandResult',
        type: 'object',
      },
      'promote_to_cohost output',
    )
  },
}

export const operationEnableE2ee: Validators<EnableE2eeInput, EnableE2eeOutput> = {
  validateInput(value: unknown): asserts value is EnableE2eeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'enable_e2ee input',
    )
  },
  validateOutput(value: unknown): asserts value is EnableE2eeOutput {
    assertSchema(value, { type: 'boolean' }, 'enable_e2ee output')
  },
}

export const operationUpdateSettings: Validators<UpdateSettingsInput, UpdateSettingsOutput> = {
  validateInput(value: unknown): asserts value is UpdateSettingsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          allow_guest: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Allow Guest',
          },
          meeting_type: { enum: ['open', 'restricted'], title: 'Meeting Type', type: 'string' },
          host_only_chat: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Host Only Chat',
          },
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'update_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateSettingsOutput {
    assertSchema(
      value,
      {
        properties: {
          allow_guest: { title: 'Allow Guest', type: 'boolean' },
          meeting_type: { enum: ['open', 'restricted'], title: 'Meeting Type', type: 'string' },
          host_only_chat: { title: 'Host Only Chat', type: 'boolean' },
        },
        title: 'SettingsResult',
        type: 'object',
      },
      'update_settings output',
    )
  },
}
