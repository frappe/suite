import { defineComponent, h, type Component } from "vue";
import type { RouteMeta, RouteRecordRaw } from "vue-router";

import type { AreaDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

const FilesIcon = defineComponent({
  name: "FilesAreaIcon",
  setup: () => () =>
    h("span", { class: "lucide-folder size-4", "aria-hidden": "true" }),
});

function filesMeta(title: string, allowGuest = false): RouteMeta {
  return {
    area: "files",
    frame: "area",
    scroll: "shell",
    allowGuest,
    title,
    favicon: "/assets/suite/drive/images/logo.svg",
  };
}

async function loadFilesRoutes(): Promise<{ routes: RouteRecordRaw[] }> {
  const { PageHeader, PageHeaderMobile, PageHeaderTitle } =
    await import("frappe-ui");
  const rows = Array.from(
    { length: 200 },
    (_, index) => `${__("File")} ${index + 1}`,
  );

  function placeholder(title: string): Component {
    return defineComponent({
      name: "FilesPlaceholder",
      setup: () => () =>
        h("div", { class: "min-w-0" }, [
          h(
            PageHeader,
            { class: "hidden md:flex" },
            { default: () => h(PageHeaderTitle, { title }) },
          ),
          h(PageHeaderMobile, { class: "md:hidden", title }),
          h(
            "div",
            {
              class: "mx-auto w-full max-w-[940px] px-3 pb-40 pt-5 sm:px-5",
              "data-files-placeholder": "",
            },
            [
              h(
                "p",
                { class: "mb-4 text-p-sm text-ink-gray-5" },
                __("Files is ready for W3-files."),
              ),
              h(
                "div",
                {
                  class:
                    "divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-1",
                },
                rows.map((row) =>
                  h(
                    "div",
                    {
                      class:
                        "flex h-12 items-center gap-3 px-3 text-base text-ink-gray-8",
                    },
                    [
                      h("span", {
                        class: "lucide-file size-4 text-ink-gray-5",
                        "aria-hidden": "true",
                      }),
                      h("span", row),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ]),
    });
  }

  const definitions: Array<[string, string, string, boolean?]> = [
    ["", "files", __("My files")],
    ["organization", "files-organization", __("Organization files")],
    ["f/:node/:slug?", "files-folder", __("Folder"), true],
    ["recent", "files-recent", __("Recent")],
    ["starred", "files-starred", __("Starred")],
    ["shared-with-me", "files-shared-with-me", __("Shared with me")],
    ["trash", "files-trash", __("Trash")],
  ];

  return {
    routes: definitions.map(([path, name, title, allowGuest]) => ({
      path,
      name,
      component: placeholder(title),
      meta: filesMeta(title, allowGuest),
    })),
  };
}

async function loadFilesPanel(): Promise<Component> {
  const { SidebarItem, SidebarLabel } = await import("frappe-ui");
  const destinations = [
    { label: __("My files"), to: "/files", icon: "lucide-folder" },
    {
      label: __("Organization files"),
      to: "/files/organization",
      icon: "lucide-building-2",
    },
    { label: __("Recent"), to: "/files/recent", icon: "lucide-clock-3" },
    { label: __("Starred"), to: "/files/starred", icon: "lucide-star" },
    {
      label: __("Shared with me"),
      to: "/files/shared-with-me",
      icon: "lucide-users",
    },
    { label: __("Trash"), to: "/files/trash", icon: "lucide-trash-2" },
  ];

  return defineComponent({
    name: "FilesPanelPlaceholder",
    setup: () => () =>
      h("nav", { class: "space-y-0.5", "aria-label": __("Files") }, [
        h(SidebarLabel, { class: "mb-1" }, { default: () => __("Files") }),
        ...destinations.map((destination) =>
          h(
            SidebarItem,
            {
              to: destination.to,
              label: destination.label,
              icon: destination.icon,
            },
            { default: () => destination.label },
          ),
        ),
      ]),
  });
}

export const filesArea: AreaDefinition = {
  id: "files",
  label: () => __("Files"),
  icon: FilesIcon,
  to: "/files",
  loadRoutes: loadFilesRoutes,
  loadPanel: loadFilesPanel,
};
