// Generated from src/apps/meet/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type RoomsPostInput = { type: 'open' | 'restricted' }

export type RoomsPostOutput = { code: string; url: string }

export type RoomsPostError = 'BadRequest'

const operationRoomsPost: MutationRef<RoomsPostInput, RoomsPostOutput, RoomsPostError> = {
  id: 'rooms_post',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.create',
  method: 'POST',
  path: 'rooms',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest'],
  loadValidators: async () => (await import('./validators')).operationRoomsPost,
}

export type ScheduledMeetingsPostInputAttendee = { email: string; name?: string }

export type ScheduledMeetingsPostOutputRoom = { code: string; url: string }

export type ScheduledMeetingsPostInput = {
  title: string
  start: string
  end: string
  attendees: Array<ScheduledMeetingsPostInputAttendee>
}

export type ScheduledMeetingsPostOutput = {
  meeting: ScheduledMeetingsPostOutputRoom
  calendar_event_id: string
}

export type ScheduledMeetingsPostError = 'BadRequest'

const operationScheduledMeetingsPost: MutationRef<
  ScheduledMeetingsPostInput,
  ScheduledMeetingsPostOutput,
  ScheduledMeetingsPostError
> = {
  id: 'scheduled_meetings_post',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'meetings.schedule',
  method: 'POST',
  path: 'scheduled-meetings',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest'],
  loadValidators: async () => (await import('./validators')).operationScheduledMeetingsPost,
}

export type RoomPreviewInput = { meeting_id: string }

export type RoomPreviewOutput = { title: string }

export type RoomPreviewError = never

const operationRoomPreview: QueryRef<RoomPreviewInput, RoomPreviewOutput, RoomPreviewError> = {
  id: 'room_preview',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.preview',
  method: 'GET',
  path: 'rooms/preview',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomPreview,
}

export type RoomAccessInput = { meeting_id: string }

export type RoomAccessOutput = { allow_guest: boolean; host_only_chat?: boolean }

export type RoomAccessError = never

const operationRoomAccess: QueryRef<RoomAccessInput, RoomAccessOutput, RoomAccessError> = {
  id: 'room_access',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.access',
  method: 'GET',
  path: 'rooms/access',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomAccess,
}

export type RoomConnectionInput = { meeting_id: string }

export type RoomConnectionOutput = { [key: string]: unknown }

export type RoomConnectionError = never

const operationRoomConnection: MutationRef<
  RoomConnectionInput,
  RoomConnectionOutput,
  RoomConnectionError
> = {
  id: 'room_connection',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.connect',
  method: 'POST',
  path: 'rooms/connections',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomConnection,
}

export type RoomPresenceTokenInput = { meeting_id: string }

export type RoomPresenceTokenOutput = {
  restricted_preview?: boolean
  auth_token?: string
  sfu_url?: string
  sfu_port?: number | null
  expires_in?: number
}

export type RoomPresenceTokenError = never

const operationRoomPresenceToken: QueryRef<
  RoomPresenceTokenInput,
  RoomPresenceTokenOutput,
  RoomPresenceTokenError
> = {
  id: 'room_presence_token',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.presenceToken',
  method: 'GET',
  path: 'rooms/presence-tokens',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomPresenceToken,
}

export type RoomJoinInput = { meeting_id: string }

export type RoomJoinOutput = { [key: string]: unknown }

export type RoomJoinError = never

const operationRoomJoin: MutationRef<RoomJoinInput, RoomJoinOutput, RoomJoinError> = {
  id: 'room_join',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.join',
  method: 'POST',
  path: 'rooms/joins',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomJoin,
}

export type GuestRoomJoinInput = {
  meeting_id: string
  guest_name: string
  guest_id?: string
  guest_session_token?: string
}

export type GuestRoomJoinOutput = { [key: string]: unknown }

export type GuestRoomJoinError = never

const operationGuestRoomJoin: MutationRef<
  GuestRoomJoinInput,
  GuestRoomJoinOutput,
  GuestRoomJoinError
> = {
  id: 'guest_room_join',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'guests.join',
  method: 'POST',
  path: 'rooms/guest-joins',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGuestRoomJoin,
}

export type GuestRoomConnectionInput = {
  meeting_id: string
  guest_id: string
  guest_session_token: string
}

export type GuestRoomConnectionOutput = { [key: string]: unknown }

export type GuestRoomConnectionError = never

const operationGuestRoomConnection: MutationRef<
  GuestRoomConnectionInput,
  GuestRoomConnectionOutput,
  GuestRoomConnectionError
> = {
  id: 'guest_room_connection',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'guests.connect',
  method: 'POST',
  path: 'rooms/guest-connections',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGuestRoomConnection,
}

export type GuestRoomTokenInput = {
  meeting_id: string
  guest_id: string
  guest_session_token: string
}

export type GuestRoomTokenOutput = { [key: string]: unknown }

export type GuestRoomTokenError = never

const operationGuestRoomToken: MutationRef<
  GuestRoomTokenInput,
  GuestRoomTokenOutput,
  GuestRoomTokenError
> = {
  id: 'guest_room_token',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'guests.refreshToken',
  method: 'POST',
  path: 'rooms/guest-tokens',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGuestRoomToken,
}

export type RoomTokenInput = { meeting_id: string }

export type RoomTokenOutput = { [key: string]: unknown }

export type RoomTokenError = never

const operationRoomToken: MutationRef<RoomTokenInput, RoomTokenOutput, RoomTokenError> = {
  id: 'room_token',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.refreshToken',
  method: 'POST',
  path: 'rooms/tokens',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomToken,
}

export type E2eeDeviceInput = { device_id: string; ed25519_public_key: string }

export type E2eeDeviceOutput = { [key: string]: unknown }

export type E2eeDeviceError = never

const operationE2eeDevice: MutationRef<E2eeDeviceInput, E2eeDeviceOutput, E2eeDeviceError> = {
  id: 'e2ee_device',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'devices.register',
  method: 'POST',
  path: 'e2ee-devices',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationE2eeDevice,
}

export type RecordingStateOutputRecordingState = {
  name: string
  status:
    | 'Pending'
    | 'Starting'
    | 'Recording'
    | 'Interrupted'
    | 'Stopping'
    | 'Processing'
    | 'Ready'
    | 'Partial'
    | 'Failed'
    | 'Cancelled'
  state_revision: number
  started_at?: string | null
  capture_started_at?: string | null
  interruption_id?: string | null
  interrupted_at?: string | null
  interruption_deadline?: string | null
}

export type RecordingStateInput = { meeting_id: string }

export type RecordingStateOutput = RecordingStateOutputRecordingState | null

export type RecordingStateError = never

const operationRecordingState: QueryRef<
  RecordingStateInput,
  RecordingStateOutput,
  RecordingStateError
> = {
  id: 'recording_state',
  owner: 'meet',
  kind: 'query',
  publicName: 'recordings.get',
  method: 'GET',
  path: 'recordings/state',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRecordingState,
}

export type RecordingPreflightInput = { meeting_id: string }

export type RecordingPreflightOutput = {
  eligible: boolean
  global_enabled: boolean
  e2ee_conflict: boolean
  storage_available: boolean
  recorder_available: boolean
  estimated_seconds: number
  estimated_bytes: number
  free_bytes: number
  budget_bytes: number
  budget_seconds: number
  maximum_seconds: number
}

export type RecordingPreflightError = never

const operationRecordingPreflight: QueryRef<
  RecordingPreflightInput,
  RecordingPreflightOutput,
  RecordingPreflightError
> = {
  id: 'recording_preflight',
  owner: 'meet',
  kind: 'query',
  publicName: 'recordings.preflight',
  method: 'GET',
  path: 'recordings/preflight',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRecordingPreflight,
}

export type RecordingStartOutputRecordingCommand = {
  name: string
  status:
    | 'Pending'
    | 'Starting'
    | 'Recording'
    | 'Interrupted'
    | 'Stopping'
    | 'Processing'
    | 'Ready'
    | 'Partial'
    | 'Failed'
    | 'Cancelled'
  grant_delivered?: boolean
}

export type RecordingStartOutputRejectedRecording = { status: 'Rejected' }

export type RecordingStartInput = { meeting_id: string; request_id: string }

export type RecordingStartOutput =
  RecordingStartOutputRecordingCommand | RecordingStartOutputRejectedRecording

export type RecordingStartError = never

const operationRecordingStart: MutationRef<
  RecordingStartInput,
  RecordingStartOutput,
  RecordingStartError
> = {
  id: 'recording_start',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'recordings.start',
  method: 'POST',
  path: 'recordings/starts',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRecordingStart,
}

export type RecordingStopOutputRecordingCommand = {
  name: string
  status:
    | 'Pending'
    | 'Starting'
    | 'Recording'
    | 'Interrupted'
    | 'Stopping'
    | 'Processing'
    | 'Ready'
    | 'Partial'
    | 'Failed'
    | 'Cancelled'
  grant_delivered?: boolean
}

export type RecordingStopInput = { meeting_id: string }

export type RecordingStopOutput = RecordingStopOutputRecordingCommand | null

export type RecordingStopError = never

const operationRecordingStop: MutationRef<
  RecordingStopInput,
  RecordingStopOutput,
  RecordingStopError
> = {
  id: 'recording_stop',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'recordings.stop',
  method: 'POST',
  path: 'recordings/stops',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRecordingStop,
}

export type CalendarMeetingInput = {
  account: string
  user?: string
  organizer?: string
  calendar_ids?: Array<string>
  status?: string
  draft?: boolean
  title?: string
  start?: string
  duration?: string
  time_zone?: string
  recurrence_rule?: { [key: string]: unknown }
  show_without_time?: boolean
  participants?: Array<{ [key: string]: unknown }>
  description?: string
  locations?: Array<{ [key: string]: unknown }>
  alerts?: Array<{ [key: string]: unknown }>
  free_busy_status?: string
  privacy?: string
  use_default_alerts?: boolean
  send_scheduling_messages?: boolean
  meeting_type?: string
}

export type CalendarMeetingOutput = { meeting_id: string; meeting_url: string; event_id: string }

export type CalendarMeetingError = never

const operationCalendarMeeting: MutationRef<
  CalendarMeetingInput,
  CalendarMeetingOutput,
  CalendarMeetingError
> = {
  id: 'calendar_meeting',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'meetings.createCalendar',
  method: 'POST',
  path: 'calendar-meetings',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationCalendarMeeting,
}

export type RoomLinkInput = { account: string; title?: string; meeting_type?: string }

export type RoomLinkOutput = { meeting_id: string; meeting_url: string }

export type RoomLinkError = never

const operationRoomLink: MutationRef<RoomLinkInput, RoomLinkOutput, RoomLinkError> = {
  id: 'room_link',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.createLink',
  method: 'POST',
  path: 'room-links',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomLink,
}

export type RecentRoomsOutputRecentRoom = {
  id: string
  title: string | null
  last_joined: string
  recording: string | null
}

export type RecentRoomsInput = Record<string, never>

export type RecentRoomsOutput = Array<RecentRoomsOutputRecentRoom>

export type RecentRoomsError = never

const operationRecentRooms: QueryRef<RecentRoomsInput, RecentRoomsOutput, RecentRoomsError> = {
  id: 'recent_rooms',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.recent',
  method: 'GET',
  path: 'rooms/recent',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRecentRooms,
}

export type RecordingListOutputRecordingSummary = {
  name: string
  meet_room: string
  room_title: string | null
  started_at: string | null
  artifact: string
  artifact_duration: number | null
  status: 'Ready' | 'Partial'
}

export type RecordingListInput = Record<string, never>

export type RecordingListOutput = Array<RecordingListOutputRecordingSummary>

export type RecordingListError = never

const operationRecordingList: QueryRef<
  RecordingListInput,
  RecordingListOutput,
  RecordingListError
> = {
  id: 'recording_list',
  owner: 'meet',
  kind: 'query',
  publicName: 'recordings.list',
  method: 'GET',
  path: 'recordings',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRecordingList,
}

export type RoomSearchOutputRoomSummary = { name: string; title: string | null }

export type RoomSearchInput = { q: string }

export type RoomSearchOutput = Array<RoomSearchOutputRoomSummary>

export type RoomSearchError = never

const operationRoomSearch: QueryRef<RoomSearchInput, RoomSearchOutput, RoomSearchError> = {
  id: 'room_search',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.search',
  method: 'GET',
  path: 'rooms/search',
  prefix: '/api/suite/meet/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomSearch,
}

export type RoomDocumentOutputRoomUser = { user: string }

export type RoomDocumentInput = { name: string }

export type RoomDocumentOutput = {
  name: string
  owner: string
  title: string | null
  co_hosts: Array<RoomDocumentOutputRoomUser>
  allow_guest: boolean | (0 | 1)
  meeting_type: 'open' | 'restricted'
  host_only_chat: boolean | (0 | 1)
  e2ee_enabled: boolean | (0 | 1)
}

export type RoomDocumentError = never

const operationRoomDocument: QueryRef<RoomDocumentInput, RoomDocumentOutput, RoomDocumentError> = {
  id: 'room_document',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.get',
  method: 'GET',
  path: '/api/v2/document/Meet Room/{name}',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRoomDocument,
}

export type ApproveJoinRequestInput = { user_id: string; name: string }

export type ApproveJoinRequestOutput = { meeting_id: string; message: string; user_id?: string }

export type ApproveJoinRequestError = never

const operationApproveJoinRequest: MutationRef<
  ApproveJoinRequestInput,
  ApproveJoinRequestOutput,
  ApproveJoinRequestError
> = {
  id: 'approve_join_request',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.approve',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/approve_join_request',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationApproveJoinRequest,
}

export type ApproveAllJoinRequestsInput = { name: string }

export type ApproveAllJoinRequestsOutput = { meeting_id: string; message: string; user_id?: string }

export type ApproveAllJoinRequestsError = never

const operationApproveAllJoinRequests: MutationRef<
  ApproveAllJoinRequestsInput,
  ApproveAllJoinRequestsOutput,
  ApproveAllJoinRequestsError
> = {
  id: 'approve_all_join_requests',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.approveAll',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/approve_all_join_requests',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationApproveAllJoinRequests,
}

export type RejectJoinRequestInput = { user_id: string; name: string }

export type RejectJoinRequestOutput = { meeting_id: string; message: string; user_id?: string }

export type RejectJoinRequestError = never

const operationRejectJoinRequest: MutationRef<
  RejectJoinRequestInput,
  RejectJoinRequestOutput,
  RejectJoinRequestError
> = {
  id: 'reject_join_request',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.reject',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/reject_join_request',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRejectJoinRequest,
}

export type GetWaitingRoomDetailsOutputWaitingUser = {
  user_id: string
  full_name: string
  user_name: string
  user_image: string | null
  is_guest: boolean
}

export type GetWaitingRoomDetailsInput = { name: string }

export type GetWaitingRoomDetailsOutput = {
  meeting_id: string
  waiting_users: Array<GetWaitingRoomDetailsOutputWaitingUser>
}

export type GetWaitingRoomDetailsError = never

const operationGetWaitingRoomDetails: QueryRef<
  GetWaitingRoomDetailsInput,
  GetWaitingRoomDetailsOutput,
  GetWaitingRoomDetailsError
> = {
  id: 'get_waiting_room_details',
  owner: 'meet',
  kind: 'query',
  publicName: 'rooms.waiting',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/get_waiting_room_details',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetWaitingRoomDetails,
}

export type BanGuestInput = { guest_id: string; name: string }

export type BanGuestOutput = { meeting_id: string; guest_id: string; status: 'banned' }

export type BanGuestError = never

const operationBanGuest: MutationRef<BanGuestInput, BanGuestOutput, BanGuestError> = {
  id: 'ban_guest',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.banGuest',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/ban_guest',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationBanGuest,
}

export type PromoteToCohostInput = { user_id: string; name: string }

export type PromoteToCohostOutput = { meeting_id: string; message: string; user_id?: string }

export type PromoteToCohostError = never

const operationPromoteToCohost: MutationRef<
  PromoteToCohostInput,
  PromoteToCohostOutput,
  PromoteToCohostError
> = {
  id: 'promote_to_cohost',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.promote',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/promote_to_cohost',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationPromoteToCohost,
}

export type EnableE2eeInput = { name: string }

export type EnableE2eeOutput = boolean

export type EnableE2eeError = never

const operationEnableE2ee: MutationRef<EnableE2eeInput, EnableE2eeOutput, EnableE2eeError> = {
  id: 'enable_e2ee',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.enableEncryption',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/enable_e2ee',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationEnableE2ee,
}

export type UpdateSettingsInput = {
  allow_guest?: boolean | (0 | 1)
  meeting_type?: 'open' | 'restricted'
  host_only_chat?: boolean | (0 | 1)
  name: string
}

export type UpdateSettingsOutput = {
  allow_guest?: boolean
  meeting_type?: 'open' | 'restricted'
  host_only_chat?: boolean
}

export type UpdateSettingsError = never

const operationUpdateSettings: MutationRef<
  UpdateSettingsInput,
  UpdateSettingsOutput,
  UpdateSettingsError
> = {
  id: 'update_settings',
  owner: 'meet',
  kind: 'mutation',
  publicName: 'rooms.updateSettings',
  method: 'POST',
  path: '/api/v2/document/Meet Room/{name}/method/update_settings',
  prefix: '/api/suite/meet/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateSettings,
}

export const api = {
  rooms: {
    create: operationRoomsPost,
    preview: operationRoomPreview,
    access: operationRoomAccess,
    connect: operationRoomConnection,
    presenceToken: operationRoomPresenceToken,
    join: operationRoomJoin,
    refreshToken: operationRoomToken,
    createLink: operationRoomLink,
    recent: operationRecentRooms,
    search: operationRoomSearch,
    get: operationRoomDocument,
    approve: operationApproveJoinRequest,
    approveAll: operationApproveAllJoinRequests,
    reject: operationRejectJoinRequest,
    waiting: operationGetWaitingRoomDetails,
    banGuest: operationBanGuest,
    promote: operationPromoteToCohost,
    enableEncryption: operationEnableE2ee,
    updateSettings: operationUpdateSettings,
  },
  meetings: {
    schedule: operationScheduledMeetingsPost,
    createCalendar: operationCalendarMeeting,
  },
  guests: {
    join: operationGuestRoomJoin,
    connect: operationGuestRoomConnection,
    refreshToken: operationGuestRoomToken,
  },
  devices: {
    register: operationE2eeDevice,
  },
  recordings: {
    get: operationRecordingState,
    preflight: operationRecordingPreflight,
    start: operationRecordingStart,
    stop: operationRecordingStop,
    list: operationRecordingList,
  },
} as const
