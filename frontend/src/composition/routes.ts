import { defineAsyncComponent, defineComponent, h, type Component } from "vue";
import type { RouteMeta, RouteRecordRaw } from "vue-router";

import { lastAppPrefix } from "@/utils/lastApp";

const calendarLogo = "/assets/suite/calendar/images/logo.svg";
const driveLogo = "/assets/suite/drive/images/logo.svg";
const mailLogo = "/assets/suite/mail/images/logo.svg";
const suiteLogo = "/assets/suite/frontend/logo.svg";

const RouteLoading = defineComponent({
  name: "RouteLoading",
  setup: () => () => h("div", { class: "h-full min-h-0 w-full min-w-0" }),
});

function areaMeta(
  area: string,
  title: string,
  favicon: string,
  options: {
    frame?: "area" | "none";
    scroll?: "shell" | "content";
    allowGuest?: boolean;
  } = {},
): RouteMeta {
  return {
    area,
    frame: options.frame ?? "area",
    scroll: options.scroll ?? "shell",
    allowGuest: options.allowGuest,
    title,
    favicon,
  };
}

function placeholder(
  path: string,
  name: string,
  meta: RouteMeta,
  component: Component = RouteLoading,
): RouteRecordRaw {
  return { path, name, component, meta };
}

export const canonicalRoutes: RouteRecordRaw[] = [
  placeholder(
    "/home",
    "area-placeholder-home",
    areaMeta("home", "Home", suiteLogo),
  ),
  placeholder(
    "/files",
    "area-placeholder-files-root",
    areaMeta("files", "My files", driveLogo),
  ),
  placeholder(
    "/files/organization",
    "area-placeholder-files-organization",
    areaMeta("files", "Organization files", driveLogo),
  ),
  placeholder(
    "/files/f/:node/:slug?",
    "area-placeholder-files-folder",
    areaMeta("files", "Folder", driveLogo, { allowGuest: true }),
  ),
  placeholder(
    "/files/recent",
    "area-placeholder-files-recent",
    areaMeta("files", "Recent", driveLogo),
  ),
  placeholder(
    "/files/starred",
    "area-placeholder-files-starred",
    areaMeta("files", "Starred", driveLogo),
  ),
  placeholder(
    "/files/shared-with-me",
    "area-placeholder-files-shared-with-me",
    areaMeta("files", "Shared with me", driveLogo),
  ),
  placeholder(
    "/files/trash",
    "area-placeholder-files-trash",
    areaMeta("files", "Trash", driveLogo),
  ),
  placeholder(
    "/mail/:pathMatch(.*)*",
    "area-placeholder-mail",
    areaMeta("mail", "Mail", mailLogo, { frame: "none", scroll: "content" }),
  ),
  placeholder(
    "/calendar/:pathMatch(.*)*",
    "area-placeholder-calendar",
    areaMeta("calendar", "Calendar", calendarLogo, {
      frame: "none",
      scroll: "content",
    }),
  ),
  placeholder(
    "/d/:node/:slug?",
    "document-host",
    {
      ...areaMeta("files", "Document", driveLogo, { allowGuest: true }),
      frame: "document",
      scroll: "content",
    },
    defineAsyncRoute(() => import("@/composition/DocumentHost.vue")),
  ),
  placeholder(
    "/l/:token",
    "link-unavailable",
    areaMeta("files", "Shared link", driveLogo, { allowGuest: true }),
    defineAsyncRoute(() => import("@/shell/UnavailableSurface.vue"), {
      reason: "Shared-link credentials are not available yet.",
      nextStep:
        "Ask the sender for access another way. Ticket 011 owns this flow.",
    }),
  ),
];

export const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/home" },
  ...canonicalRoutes,
  {
    path: "/suite",
    name: "suite-launcher",
    component: () => import("@/shell/LauncherView.vue"),
    meta: {
      frame: "none",
      scroll: "content",
      title: "Frappe Suite",
      favicon: suiteLogo,
    },
  },
  {
    path: "/suite/start",
    name: "suite-start",
    redirect: () => lastAppPrefix(),
  },
  {
    path: "/suite/setup",
    name: "suite-setup",
    component: () => import("@/shell/SetupView.vue"),
    meta: {
      frame: "none",
      scroll: "content",
      title: "Set up Frappe Suite",
      favicon: suiteLogo,
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("@/shell/NotFoundView.vue"),
    meta: {
      frame: "none",
      scroll: "content",
      title: "Frappe Suite",
      favicon: suiteLogo,
    },
  },
];

export function areaPlaceholderNames(areaId: string): string[] {
  return canonicalRoutes
    .map((route) => ({
      name: String(route.name ?? ""),
      area: route.meta?.area,
    }))
    .filter(
      (route) =>
        route.area === areaId && route.name.startsWith("area-placeholder-"),
    )
    .map((route) => route.name);
}

function defineAsyncRoute(
  loader: () => Promise<{ default: Component }>,
  props?: Record<string, unknown>,
): Component {
  const AsyncComponent = defineAsyncComponent(loader);
  return defineComponent({
    name: "AsyncRoute",
    setup: () => () => h(AsyncComponent, props),
  });
}
