import type { CalendarEvent } from "@/apps/calendar";

export interface HomeEventGroup {
  day: "Today" | "Tomorrow";
  events: CalendarEvent[];
}

export function homeEventWindow(now = new Date()): {
  from: string;
  to: string;
} {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  end.setMilliseconds(-1);
  return { from: now.toISOString(), to: end.toISOString() };
}

export function groupHomeEvents(
  events: readonly CalendarEvent[],
  now = new Date(),
): HomeEventGroup[] {
  const today = localDayKey(now);
  const tomorrowDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  const tomorrow = localDayKey(tomorrowDate);
  const groups: Record<HomeEventGroup["day"], CalendarEvent[]> = {
    Today: [],
    Tomorrow: [],
  };

  for (const event of events) {
    const start = parseDate(event.start);
    if (!start) continue;
    const key = localDayKey(start);
    if (key === today) groups.Today.push(event);
    if (key === tomorrow) groups.Tomorrow.push(event);
  }

  return (["Today", "Tomorrow"] as const)
    .map((day) => ({
      day,
      events: groups[day].sort(compareEventStart),
    }))
    .filter((group) => group.events.length > 0);
}

export function formatEventTime(event: CalendarEvent): string {
  if (event.show_without_time) return "All day";
  const start = parseDate(event.start);
  if (!start) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

export function formatOpenedAt(
  openedAt: string | null | undefined,
  now = new Date(),
): string {
  const opened = parseDate(openedAt);
  if (!opened) return "Opened recently";
  const seconds = Math.round((opened.getTime() - now.getTime()) / 1_000);
  const absolute = Math.abs(seconds);
  const [amount, unit] =
    absolute < 60
      ? [seconds, "second"]
      : absolute < 3_600
        ? [Math.round(seconds / 60), "minute"]
        : absolute < 86_400
          ? [Math.round(seconds / 3_600), "hour"]
          : [Math.round(seconds / 86_400), "day"];
  const relative = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  }).format(amount, unit as Intl.RelativeTimeFormatUnit);
  return `Opened ${relative}`;
}

export function toLocalDateTimeInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function compareEventStart(left: CalendarEvent, right: CalendarEvent): number {
  return (
    (parseDate(left.start)?.getTime() ?? 0) -
    (parseDate(right.start)?.getTime() ?? 0)
  );
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDayKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}
