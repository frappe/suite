import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/apps/calendar";
import { groupHomeEvents, homeEventWindow } from "@/composition/home/homeTime";

describe("Home upcoming dates", () => {
  it("groups Today and Tomorrow around midnight", () => {
    const now = new Date(2026, 8, 15, 23, 59, 30);
    const events: CalendarEvent[] = [
      {
        id: "later",
        title: "Tomorrow later",
        start: localIso(2026, 8, 16, 9, 0),
      },
      {
        id: "today",
        title: "Before midnight",
        start: localIso(2026, 8, 15, 23, 59, 45),
      },
      {
        id: "midnight",
        title: "At midnight",
        start: localIso(2026, 8, 16, 0, 0),
      },
      { id: "outside", title: "Day after", start: localIso(2026, 8, 17, 0, 0) },
    ];

    expect(groupHomeEvents(events, now)).toEqual([
      { day: "Today", events: [events[1]] },
      { day: "Tomorrow", events: [events[2], events[0]] },
    ]);
  });

  it("queries from now through the final millisecond of tomorrow", () => {
    const now = new Date(2026, 8, 15, 23, 59, 30);
    const range = homeEventWindow(now);

    expect(new Date(range.from).getTime()).toBe(now.getTime());
    expect(new Date(range.to)).toEqual(new Date(2026, 8, 16, 23, 59, 59, 999));
  });
});

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return new Date(year, month, day, hour, minute).toISOString();
}
