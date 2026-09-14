export { createRoom, scheduleMeeting } from "@/apps/meet/client/mutations";
export type {
  RoomsPostInput as CreateRoomInput,
  RoomsPostOutput as Room,
  ScheduledMeetingsPostInput as ScheduleMeetingInput,
  ScheduledMeetingsPostOutput as ScheduledMeeting,
} from "@/apps/meet/client/generated";
