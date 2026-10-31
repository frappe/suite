import MeetIcon from '@/apps/meet/AreaIcon.vue'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

export { default as ScheduleMeetingDialog } from './components/ScheduleMeetingDialog.vue'

export type {
  RoomsPostInput as CreateRoomInput,
  RoomsPostOutput as Room,
  ScheduledMeetingsPostInput as ScheduleMeetingInput,
  ScheduledMeetingsPostOutput as ScheduledMeeting,
} from '@/apps/meet/client/generated'

/** Meet has no capability gate: every signed-in user can start or join a call [T010]. */
export const meetArea: AreaDefinition = {
  id: 'meet',
  label: () => __('Meet'),
  icon: MeetIcon,
  to: '/meet',
  loadRoutes: () => import('@/apps/meet/routes'),
}
