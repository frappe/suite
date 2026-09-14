import type { DriveNotification } from "@/composition/notifications/client";

export function notificationTitle(notification: DriveNotification): string {
  const detail = notification.activity.detail;
  return text(detail.title) ?? text(detail.node_title) ?? "Drive item";
}

export function notificationDescription(
  notification: DriveNotification,
): string {
  const actor = notification.activity.actor || "Someone";
  const action = notification.activity.action.replaceAll("_", " ");
  return `${actor} ${action}`;
}

export function notificationTime(
  value: string | null | undefined,
  now = new Date(),
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1_000);
  const absolute = Math.abs(seconds);
  const [amount, unit] =
    absolute < 60
      ? [seconds, "second"]
      : absolute < 3_600
        ? [Math.round(seconds / 60), "minute"]
        : absolute < 86_400
          ? [Math.round(seconds / 3_600), "hour"]
          : [Math.round(seconds / 86_400), "day"];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    amount,
    unit as Intl.RelativeTimeFormatUnit,
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
