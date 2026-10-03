import MeetIcon from '@/apps/meet/AreaIcon.vue'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

export { createRoom, scheduleMeeting } from '@/apps/meet/client/mutations'
export type {
  RoomsPostInput as CreateRoomInput,
  RoomsPostOutput as Room,
  ScheduledMeetingsPostInput as ScheduleMeetingInput,
  ScheduledMeetingsPostOutput as ScheduledMeeting,
} from '@/apps/meet/client/generated'

/** Meet's Settings group. Loads when Settings opens. */
export const loadMeetSettings = () =>
  import('@/apps/meet/settings').then((module) => module.meetSettings)

/** Meet has no capability gate: every signed-in user can start or join a call [T010]. */
export const meetArea: AreaDefinition = {
  id: 'meet',
  label: () => __('Meet'),
  icon: MeetIcon,
  to: '/meet',
  loadRoutes: () => import('@/apps/meet/routes'),
}
