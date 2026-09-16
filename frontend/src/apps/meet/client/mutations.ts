import { mutation } from "@/platform/server-state";

import { api } from "./generated";

export const createRoom = mutation(api.rooms_post);
export const scheduleMeeting = mutation(api.scheduled_meetings_post);
