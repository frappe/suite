export { createRoom, scheduleMeeting } from "@/apps/meet/client/mutations";
export type {
  RoomsPostInput as CreateRoomInput,
  RoomsPostOutput as Room,
  ScheduledMeetingsPostInput as ScheduleMeetingInput,
  ScheduledMeetingsPostOutput as ScheduledMeeting,
} from "@/apps/meet/client/generated";

/** Meet's Settings group. Loads when Settings opens. */
export const loadMeetSettings = () =>
  import("@/apps/meet/settings").then((module) => module.meetSettings);
