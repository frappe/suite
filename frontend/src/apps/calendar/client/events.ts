import { query } from "@/platform/server-state";

import { api, type EventsGetOutput } from "./generated";

export type CalendarEvent = EventsGetOutput[number];

export interface UpcomingEventsInput {
  from: string;
  to: string;
}

export function upcomingEvents(input: UpcomingEventsInput) {
  return query(api.events_get, input);
}
