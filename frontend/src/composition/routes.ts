import { defineAsyncComponent, defineComponent, h, type Component } from "vue";
import type { RouteMeta, RouteRecordRaw } from "vue-router";

import { readBootFlag } from "@/platform/boot";
import type { PhoneChromeOwner, ShellFrame } from "@/platform/contracts";

const calendarLogo = "/assets/suite/calendar/images/logo.svg";
const driveLogo = "/assets/suite/drive/images/logo.svg";
const mailLogo = "/assets/suite/mail/images/logo.svg";
const meetLogo = "/assets/suite/meet/images/meet.png";
const suiteLogo = "/assets/suite/frontend/logo.svg";

/**
 * Mail, Calendar and Meet render in the shell while `suite_flip_shell` is on.
 * Off, they stay outside it and draw their standalone chrome [T018].
 */
export const adoptedAppFrame: ShellFrame = readBootFlag("suite_flip_shell")
  ? "shell"
  : "none";

const RouteLoading = defineComponent({
  name: "RouteLoading",
  setup: () => () => h("div", { class: "h-full min-h-0 w-full min-w-0" }),
});

function areaMeta(
  area: string,
  title: string,
  favicon: string,
  options: {
    frame?: ShellFrame;
    scroll?: "shell" | "content";
    phoneChrome?: PhoneChromeOwner;
    allowGuest?: boolean;
  } = {},
): RouteMeta {
  return {
    area,
    frame: options.frame ?? "shell",
    scroll: options.scroll ?? "shell",
    phoneChrome: options.phoneChrome,
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

/**
 * `suite_flip_files` selects which route table mounts under `/drive`: on, the
 * Drive area; off, the old Drive pages (the router's legacy group). Home and
 * `/d/` answer in both states [T013, T020].
 */
export const driveAreaMounted = readBootFlag("suite_flip_files");

const driveAreaRoutes: RouteRecordRaw[] = [
  placeholder(
    "/drive",
    "area-placeholder-files-root",
    areaMeta("files", "My files", driveLogo),
  ),
  placeholder(
    "/drive/organization",
    "area-placeholder-files-organization",
    areaMeta("files", "Organization files", driveLogo),
  ),
  placeholder(
    "/drive/f/:node/:slug?",
    "area-placeholder-files-folder",
    areaMeta("files", "Folder", driveLogo, { allowGuest: true }),
  ),
  placeholder(
    "/drive/recent",
    "area-placeholder-files-recent",
    areaMeta("files", "Recent", driveLogo),
  ),
  placeholder(
    "/drive/starred",
    "area-placeholder-files-starred",
    areaMeta("files", "Starred", driveLogo),
  ),
  placeholder(
    "/drive/shared-with-me",
    "area-placeholder-files-shared-with-me",
    areaMeta("files", "Shared with me", driveLogo),
  ),
  placeholder(
    "/drive/trash",
    "area-placeholder-files-trash",
    areaMeta("files", "Trash", driveLogo),
  ),
];

export const canonicalRoutes: RouteRecordRaw[] = [
  placeholder(
    "/home",
    "area-placeholder-home",
    areaMeta("home", "Home", suiteLogo),
  ),
  ...(driveAreaMounted ? driveAreaRoutes : []),
  // Mail and Calendar keep their own phone chrome: inset and tab bar [T010]. The area group
  // copies this metadata, so every Mail and Calendar page inherits it.
  placeholder(
    "/mail/:pathMatch(.*)*",
    "area-placeholder-mail",
    areaMeta("mail", "Mail", mailLogo, {
      frame: adoptedAppFrame,
      scroll: "content",
      phoneChrome: "page",
    }),
  ),
  placeholder(
    "/calendar/:pathMatch(.*)*",
    "area-placeholder-calendar",
    areaMeta("calendar", "Calendar", calendarLogo, {
      frame: adoptedAppFrame,
      scroll: "content",
      phoneChrome: "page",
    }),
  ),
  // One placeholder holds the whole prefix. A call (`/meet/:meetingId`) sets
  // its own frame `none` and admits guests in Meet's route module.
  placeholder(
    "/meet/:pathMatch(.*)*",
    "area-placeholder-meet",
    areaMeta("meet", "Meet", meetLogo, {
      frame: adoptedAppFrame,
      scroll: "content",
    }),
  ),
  // The tab says "Opening…" until the document host names it after the node,
  // unless the opener named the node in the history entry (`openingTitleState`).
  placeholder(
    "/d/:node/:slug?",
    "document-host",
    areaMeta("files", "Opening…", driveLogo, {
      scroll: "content",
      allowGuest: true,
    }),
    defineAsyncRoute(() => import("@/composition/DocumentHost.vue")),
  ),
];

export const routes: RouteRecordRaw[] = [
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
): Component {
  const AsyncComponent = defineAsyncComponent(loader);
  return defineComponent({
    name: "AsyncRoute",
    setup: () => () => h(AsyncComponent),
  });
}
