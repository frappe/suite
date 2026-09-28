// Generated from src/apps/meet/client/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type RoomsPostInput = { "type": "instant" | "restricted" }

export type RoomsPostOutput = { "code": string; "url": string }

export type RoomsPostError = "BadRequest"

const operationRoomsPost: Operation<RoomsPostInput, RoomsPostOutput, RoomsPostError> = {
  id: "rooms_post",
  owner: "meet",
  method: "POST",
  path: "rooms",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["BadRequest"],
  validateInput(value): asserts value is RoomsPostInput { assertSchema(value, {"type":"object","properties":{"type":{"enum":["instant","restricted"],"title":"Type","type":"string"}},"required":["type"],"additionalProperties":false,"$defs":{}}, 'rooms_post input') },
  validateOutput(value): asserts value is RoomsPostOutput { assertSchema(value, {"properties":{"code":{"title":"Code","type":"string"},"url":{"title":"Url","type":"string"}},"required":["code","url"],"title":"Room","type":"object"}, 'rooms_post output') },
}

export type ScheduledMeetingsPostInput = { "title": string; "start": string; "end": string; "attendees": Array<{ "email": string; "name"?: string }> }

export type ScheduledMeetingsPostOutput = { "meeting": { "code": string; "url": string }; "calendar_event_id": string }

export type ScheduledMeetingsPostError = "BadRequest"

const operationScheduledMeetingsPost: Operation<ScheduledMeetingsPostInput, ScheduledMeetingsPostOutput, ScheduledMeetingsPostError> = {
  id: "scheduled_meetings_post",
  owner: "meet",
  method: "POST",
  path: "scheduled-meetings",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["BadRequest"],
  validateInput(value): asserts value is ScheduledMeetingsPostInput { assertSchema(value, {"type":"object","properties":{"title":{"title":"Title","type":"string"},"start":{"title":"Start","type":"string"},"end":{"title":"End","type":"string"},"attendees":{"items":{"$ref":"#/$defs/Attendee"},"title":"Attendees","type":"array"}},"required":["title","start","end","attendees"],"additionalProperties":false,"$defs":{"Attendee":{"properties":{"email":{"title":"Email","type":"string"},"name":{"title":"Name","type":"string"}},"required":["email"],"title":"Attendee","type":"object"}}}, 'scheduled_meetings_post input') },
  validateOutput(value): asserts value is ScheduledMeetingsPostOutput { assertSchema(value, {"$defs":{"Room":{"properties":{"code":{"title":"Code","type":"string"},"url":{"title":"Url","type":"string"}},"required":["code","url"],"title":"Room","type":"object"}},"properties":{"meeting":{"$ref":"#/$defs/Room"},"calendar_event_id":{"title":"Calendar Event Id","type":"string"}},"required":["meeting","calendar_event_id"],"title":"ScheduledMeeting","type":"object"}, 'scheduled_meetings_post output') },
}

export type RoomPreviewInput = { "meeting_id": string }

export type RoomPreviewOutput = {  }

export type RoomPreviewError = never

const operationRoomPreview: Operation<RoomPreviewInput, RoomPreviewOutput, RoomPreviewError> = {
  id: "room_preview",
  owner: "meet",
  method: "GET",
  path: "rooms/preview",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomPreviewInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'room_preview input') },
  validateOutput(value): asserts value is RoomPreviewOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'room_preview output') },
}

export type RoomAccessInput = { "meeting_id": string }

export type RoomAccessOutput = {  }

export type RoomAccessError = never

const operationRoomAccess: Operation<RoomAccessInput, RoomAccessOutput, RoomAccessError> = {
  id: "room_access",
  owner: "meet",
  method: "GET",
  path: "rooms/access",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomAccessInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'room_access input') },
  validateOutput(value): asserts value is RoomAccessOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'room_access output') },
}

export type RoomConnectionInput = { "meeting_id": string }

export type RoomConnectionOutput = {  }

export type RoomConnectionError = never

const operationRoomConnection: Operation<RoomConnectionInput, RoomConnectionOutput, RoomConnectionError> = {
  id: "room_connection",
  owner: "meet",
  method: "POST",
  path: "rooms/connections",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomConnectionInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'room_connection input') },
  validateOutput(value): asserts value is RoomConnectionOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'room_connection output') },
}

export type RoomPresenceTokenInput = { "meeting_id": string }

export type RoomPresenceTokenOutput = {  }

export type RoomPresenceTokenError = never

const operationRoomPresenceToken: Operation<RoomPresenceTokenInput, RoomPresenceTokenOutput, RoomPresenceTokenError> = {
  id: "room_presence_token",
  owner: "meet",
  method: "GET",
  path: "rooms/presence-tokens",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomPresenceTokenInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'room_presence_token input') },
  validateOutput(value): asserts value is RoomPresenceTokenOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'room_presence_token output') },
}

export type RoomJoinInput = { "meeting_id": string }

export type RoomJoinOutput = {  }

export type RoomJoinError = never

const operationRoomJoin: Operation<RoomJoinInput, RoomJoinOutput, RoomJoinError> = {
  id: "room_join",
  owner: "meet",
  method: "POST",
  path: "rooms/joins",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomJoinInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'room_join input') },
  validateOutput(value): asserts value is RoomJoinOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'room_join output') },
}

export type GuestRoomJoinInput = { "meeting_id": string; "guest_name": string; "guest_id"?: string; "guest_session_token"?: string }

export type GuestRoomJoinOutput = {  }

export type GuestRoomJoinError = never

const operationGuestRoomJoin: Operation<GuestRoomJoinInput, GuestRoomJoinOutput, GuestRoomJoinError> = {
  id: "guest_room_join",
  owner: "meet",
  method: "POST",
  path: "rooms/guest-joins",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is GuestRoomJoinInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"guest_name":{"title":"Guest Name","type":"string"},"guest_id":{"title":"Guest Id","type":"string"},"guest_session_token":{"title":"Guest Session Token","type":"string"}},"required":["meeting_id","guest_name"],"additionalProperties":false,"$defs":{}}, 'guest_room_join input') },
  validateOutput(value): asserts value is GuestRoomJoinOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'guest_room_join output') },
}

export type GuestRoomConnectionInput = { "meeting_id": string; "guest_id": string; "guest_session_token": string }

export type GuestRoomConnectionOutput = {  }

export type GuestRoomConnectionError = never

const operationGuestRoomConnection: Operation<GuestRoomConnectionInput, GuestRoomConnectionOutput, GuestRoomConnectionError> = {
  id: "guest_room_connection",
  owner: "meet",
  method: "POST",
  path: "rooms/guest-connections",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is GuestRoomConnectionInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"guest_id":{"title":"Guest Id","type":"string"},"guest_session_token":{"title":"Guest Session Token","type":"string"}},"required":["meeting_id","guest_id","guest_session_token"],"additionalProperties":false,"$defs":{}}, 'guest_room_connection input') },
  validateOutput(value): asserts value is GuestRoomConnectionOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'guest_room_connection output') },
}

export type GuestRoomTokenInput = { "meeting_id": string; "guest_id": string; "guest_session_token": string }

export type GuestRoomTokenOutput = {  }

export type GuestRoomTokenError = never

const operationGuestRoomToken: Operation<GuestRoomTokenInput, GuestRoomTokenOutput, GuestRoomTokenError> = {
  id: "guest_room_token",
  owner: "meet",
  method: "POST",
  path: "rooms/guest-tokens",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is GuestRoomTokenInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"guest_id":{"title":"Guest Id","type":"string"},"guest_session_token":{"title":"Guest Session Token","type":"string"}},"required":["meeting_id","guest_id","guest_session_token"],"additionalProperties":false,"$defs":{}}, 'guest_room_token input') },
  validateOutput(value): asserts value is GuestRoomTokenOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'guest_room_token output') },
}

export type RoomTokenInput = { "meeting_id": string }

export type RoomTokenOutput = {  }

export type RoomTokenError = never

const operationRoomToken: Operation<RoomTokenInput, RoomTokenOutput, RoomTokenError> = {
  id: "room_token",
  owner: "meet",
  method: "POST",
  path: "rooms/tokens",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomTokenInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'room_token input') },
  validateOutput(value): asserts value is RoomTokenOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'room_token output') },
}

export type E2eeDeviceInput = { "device_id": string; "ed25519_public_key": string }

export type E2eeDeviceOutput = {  }

export type E2eeDeviceError = never

const operationE2eeDevice: Operation<E2eeDeviceInput, E2eeDeviceOutput, E2eeDeviceError> = {
  id: "e2ee_device",
  owner: "meet",
  method: "POST",
  path: "e2ee-devices",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is E2eeDeviceInput { assertSchema(value, {"type":"object","properties":{"device_id":{"title":"Device Id","type":"string"},"ed25519_public_key":{"title":"Ed25519 Public Key","type":"string"}},"required":["device_id","ed25519_public_key"],"additionalProperties":false,"$defs":{}}, 'e2ee_device input') },
  validateOutput(value): asserts value is E2eeDeviceOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'e2ee_device output') },
}

export type RecordingStateInput = { "meeting_id": string }

export type RecordingStateOutput = ({  }) | (null)

export type RecordingStateError = never

const operationRecordingState: Operation<RecordingStateInput, RecordingStateOutput, RecordingStateError> = {
  id: "recording_state",
  owner: "meet",
  method: "GET",
  path: "recordings/state",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RecordingStateInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'recording_state input') },
  validateOutput(value): asserts value is RecordingStateOutput { assertSchema(value, {"anyOf":[{"additionalProperties":true,"type":"object"},{"type":"null"}]}, 'recording_state output') },
}

export type RecordingPreflightInput = { "meeting_id": string }

export type RecordingPreflightOutput = {  }

export type RecordingPreflightError = never

const operationRecordingPreflight: Operation<RecordingPreflightInput, RecordingPreflightOutput, RecordingPreflightError> = {
  id: "recording_preflight",
  owner: "meet",
  method: "GET",
  path: "recordings/preflight",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RecordingPreflightInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'recording_preflight input') },
  validateOutput(value): asserts value is RecordingPreflightOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'recording_preflight output') },
}

export type RecordingStartInput = { "meeting_id": string; "request_id": string }

export type RecordingStartOutput = {  }

export type RecordingStartError = never

const operationRecordingStart: Operation<RecordingStartInput, RecordingStartOutput, RecordingStartError> = {
  id: "recording_start",
  owner: "meet",
  method: "POST",
  path: "recordings/starts",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RecordingStartInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"request_id":{"title":"Request Id","type":"string"}},"required":["meeting_id","request_id"],"additionalProperties":false,"$defs":{}}, 'recording_start input') },
  validateOutput(value): asserts value is RecordingStartOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'recording_start output') },
}

export type RecordingStopInput = { "meeting_id": string }

export type RecordingStopOutput = ({  }) | (null)

export type RecordingStopError = never

const operationRecordingStop: Operation<RecordingStopInput, RecordingStopOutput, RecordingStopError> = {
  id: "recording_stop",
  owner: "meet",
  method: "POST",
  path: "recordings/stops",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RecordingStopInput { assertSchema(value, {"type":"object","properties":{"meeting_id":{"title":"Meeting Id","type":"string"}},"required":["meeting_id"],"additionalProperties":false,"$defs":{}}, 'recording_stop input') },
  validateOutput(value): asserts value is RecordingStopOutput { assertSchema(value, {"anyOf":[{"additionalProperties":true,"type":"object"},{"type":"null"}]}, 'recording_stop output') },
}

export type CalendarMeetingInput = { "account": string; "user"?: string; "organizer"?: string; "calendar_ids"?: Array<string>; "status"?: string; "draft"?: boolean; "title"?: string; "start"?: string; "duration"?: string; "time_zone"?: string; "recurrence_rule"?: {  }; "show_without_time"?: boolean; "participants"?: Array<{  }>; "description"?: string; "locations"?: Array<{  }>; "alerts"?: Array<{  }>; "free_busy_status"?: string; "privacy"?: string; "use_default_alerts"?: boolean; "send_scheduling_messages"?: boolean; "meeting_type"?: string }

export type CalendarMeetingOutput = { "meeting_id": string; "meeting_url": string; "event_id": string }

export type CalendarMeetingError = never

const operationCalendarMeeting: Operation<CalendarMeetingInput, CalendarMeetingOutput, CalendarMeetingError> = {
  id: "calendar_meeting",
  owner: "meet",
  method: "POST",
  path: "calendar-meetings",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is CalendarMeetingInput { assertSchema(value, {"type":"object","properties":{"account":{"title":"Account","type":"string"},"user":{"title":"User","type":"string"},"organizer":{"title":"Organizer","type":"string"},"calendar_ids":{"items":{"type":"string"},"title":"Calendar Ids","type":"array"},"status":{"title":"Status","type":"string"},"draft":{"title":"Draft","type":"boolean"},"title":{"title":"Title","type":"string"},"start":{"title":"Start","type":"string"},"duration":{"title":"Duration","type":"string"},"time_zone":{"title":"Time Zone","type":"string"},"recurrence_rule":{"additionalProperties":true,"title":"Recurrence Rule","type":"object"},"show_without_time":{"title":"Show Without Time","type":"boolean"},"participants":{"items":{"additionalProperties":true,"type":"object"},"title":"Participants","type":"array"},"description":{"title":"Description","type":"string"},"locations":{"items":{"additionalProperties":true,"type":"object"},"title":"Locations","type":"array"},"alerts":{"items":{"additionalProperties":true,"type":"object"},"title":"Alerts","type":"array"},"free_busy_status":{"title":"Free Busy Status","type":"string"},"privacy":{"title":"Privacy","type":"string"},"use_default_alerts":{"title":"Use Default Alerts","type":"boolean"},"send_scheduling_messages":{"title":"Send Scheduling Messages","type":"boolean"},"meeting_type":{"title":"Meeting Type","type":"string"}},"required":["account"],"additionalProperties":false,"$defs":{}}, 'calendar_meeting input') },
  validateOutput(value): asserts value is CalendarMeetingOutput { assertSchema(value, {"properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"meeting_url":{"title":"Meeting Url","type":"string"},"event_id":{"title":"Event Id","type":"string"}},"required":["meeting_id","meeting_url","event_id"],"title":"CalendarMeetingResult","type":"object"}, 'calendar_meeting output') },
}

export type RoomLinkInput = { "account": string; "title"?: string; "meeting_type"?: string }

export type RoomLinkOutput = { "meeting_id": string; "meeting_url": string }

export type RoomLinkError = never

const operationRoomLink: Operation<RoomLinkInput, RoomLinkOutput, RoomLinkError> = {
  id: "room_link",
  owner: "meet",
  method: "POST",
  path: "room-links",
  prefix: "/api/suite/meet/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RoomLinkInput { assertSchema(value, {"type":"object","properties":{"account":{"title":"Account","type":"string"},"title":{"title":"Title","type":"string"},"meeting_type":{"title":"Meeting Type","type":"string"}},"required":["account"],"additionalProperties":false,"$defs":{}}, 'room_link input') },
  validateOutput(value): asserts value is RoomLinkOutput { assertSchema(value, {"properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"meeting_url":{"title":"Meeting Url","type":"string"}},"required":["meeting_id","meeting_url"],"title":"RoomLinkResult","type":"object"}, 'room_link output') },
}

export const api = {
  "rooms_post": operationRoomsPost,
  "scheduled_meetings_post": operationScheduledMeetingsPost,
  "room_preview": operationRoomPreview,
  "room_access": operationRoomAccess,
  "room_connection": operationRoomConnection,
  "room_presence_token": operationRoomPresenceToken,
  "room_join": operationRoomJoin,
  "guest_room_join": operationGuestRoomJoin,
  "guest_room_connection": operationGuestRoomConnection,
  "guest_room_token": operationGuestRoomToken,
  "room_token": operationRoomToken,
  "e2ee_device": operationE2eeDevice,
  "recording_state": operationRecordingState,
  "recording_preflight": operationRecordingPreflight,
  "recording_start": operationRecordingStart,
  "recording_stop": operationRecordingStop,
  "calendar_meeting": operationCalendarMeeting,
  "room_link": operationRoomLink
} as const

function assertSchema(value: unknown, schema: any, label: string, root: any = schema): void {
  if (!schema || Object.keys(schema).length === 0) return
  if (schema.$ref) return assertSchema(value, resolveRef(root, schema.$ref), label, root)
  if (schema.const !== undefined && value !== schema.const) throw new TypeError(label + ' must equal ' + JSON.stringify(schema.const))
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new TypeError(label + ' is not an allowed value')
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((part: any) => valid(value, part, root))) throw new TypeError(label + ' does not match any allowed shape')
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((part: any) => valid(value, part, root)).length !== 1) throw new TypeError(label + ' must match exactly one shape')
  if (Array.isArray(schema.allOf)) for (const part of schema.allOf) assertSchema(value, part, label, root)
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type: string) => matchesType(value, type))) throw new TypeError(label + ' has the wrong type')
  if ((types.includes('object') || schema.properties) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (record[key] === undefined) throw new TypeError(label + '.' + key + ' is required')
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (schema.properties ?? {}))) throw new TypeError(label + '.' + key + ' is not allowed')
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (record[key] !== undefined) assertSchema(record[key], child, label + '.' + key, root)
  }
  if ((types.includes('array') || schema.items) && Array.isArray(value)) value.forEach((item, index) => assertSchema(item, schema.items ?? {}, label + '[' + index + ']', root))
}

function valid(value: unknown, schema: any, root: any): boolean {
  try { assertSchema(value, schema, 'value', root); return true } catch { return false }
}

function resolveRef(root: any, ref: string): any {
  if (!ref.startsWith('#/')) throw new TypeError('Only local JSON schema references are supported')
  return ref.slice(2).split('/').reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root)
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}
