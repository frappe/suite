import { infinite, mutation, query } from "@/platform/server-state";
import { transport, type Operation } from "@/platform/transport";

export interface DriveNotification {
  name: string;
  read: number;
  creation: string | null;
  activity: {
    name: string;
    node: string;
    action: string;
    actor: string;
    at: string | null;
    via_link: string | null;
    client: string | null;
    detail: Record<string, unknown>;
  };
}

interface NotificationPage {
  rows: DriveNotification[];
  next_cursor: string | null;
}

interface NotificationNode {
  name: string;
  title: string;
  kind: string;
  mime: string | null;
  content_doctype: string | null;
}

const listOperation: Operation<
  { limit: number; cursor?: string },
  NotificationPage
> = {
  id: "notifications_list",
  owner: "drive",
  method: "GET",
  path: "notifications",
  prefix: "/api/suite/drive/",
};

const unreadCountOperation: Operation<
  Record<string, never>,
  { unread: number }
> = {
  id: "notifications_unread_count",
  owner: "drive",
  method: "GET",
  path: "notifications/unread-count",
  prefix: "/api/suite/drive/",
};

const readOperation: Operation<
  { notifications: string[] } | { all: true },
  { read: number }
> = {
  id: "notifications_read",
  owner: "drive",
  method: "POST",
  path: "notifications/read",
  prefix: "/api/suite/drive/",
};

const nodeOperation: Operation<{ node: string }, NotificationNode> = {
  id: "notification_node_get",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
};

export const notificationsFeed = () =>
  infinite(listOperation, { limit: 20 }, { cursorParam: "cursor" });

export const notificationUnreadCount = () =>
  query(unreadCountOperation, {}, { staleTime: 30_000 });

export const markNotificationsRead = mutation(readOperation, {
  invalidates: ["notifications_list", "notifications_unread_count"],
});

export function loadNotificationNode(node: string): Promise<NotificationNode> {
  return transport.request(nodeOperation, { node });
}
