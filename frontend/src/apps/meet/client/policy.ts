import type { OwnerRegistration } from '@/platform/server-state'
import type { Operation } from '@/platform/transport'

const effects = {
  update_settings: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  enable_e2ee: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  promote_to_cohost: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  ban_guest: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  reject_join_request: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  approve_all_join_requests: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  approve_join_request: {
    invalidates: ['room_document', 'room_access', 'room_preview', 'get_waiting_room_details'],
  },
  rooms_post: { invalidates: ['room_search'] },
  scheduled_meetings_post: {
    invalidates: [
      'calendar.events_get',
      'calendar.get_calendar_events',
      'calendar.get_calendar_events_with_shared',
      'calendar.get_calendar_event_density_with_shared',
      'calendar.search_calendar_events_with_shared',
    ],
  },
  room_connection: 'none',
  room_join: { invalidates: ['room_access', 'room_preview'] },
  guest_room_join: { invalidates: ['room_access', 'room_preview'] },
  guest_room_connection: 'none',
  guest_room_token: 'none',
  room_token: 'none',
  e2ee_device: 'none',
  recording_start: { invalidates: ['recording_state', 'recording_preflight'] },
  recording_stop: { invalidates: ['recording_state', 'recording_preflight'] },
  calendar_meeting: {
    invalidates: [
      'calendar.events_get',
      'calendar.get_calendar_events',
      'calendar.get_calendar_events_with_shared',
      'calendar.get_calendar_event_density_with_shared',
      'calendar.search_calendar_events_with_shared',
    ],
  },
  room_link: 'none',
} as const

// Tokens and connection details establish a protocol session; ordinary readers do not consume them.
export const registration: OwnerRegistration = {
  policy<I, O>(reference: Operation<I, O>) {
    if (reference.kind === 'query') return {}
    const effect = effects[reference.id as keyof typeof effects]
    if (!effect) throw new TypeError(`Missing Meet effects: ${reference.id}`)
    return { effects: effect }
  },
}
