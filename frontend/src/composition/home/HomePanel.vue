<template>
  <div class="flex h-7 items-center">
    <SidebarLabel>{{ __("Drive") }}</SidebarLabel>
  </div>
  <nav class="mt-0.5 space-y-0.5" :aria-label="__('Drive')">
    <SidebarItem
      v-for="item in destinations"
      :key="item.to"
      :icon="item.icon"
      :label="item.label"
      :route="item.to"
    />
  </nav>
</template>

<script setup lang="ts">
import { SidebarItem, SidebarLabel } from "frappe-ui";

import { translate as __ } from "@/platform/translation";

const destinations = [
  { label: __("My files"), to: "/drive", icon: "lucide-folder" },
  {
    label: __("Shared with me"),
    to: "/drive/shared-with-me",
    icon: "lucide-users",
  },
  { label: __("Starred"), to: "/drive/starred", icon: "lucide-star" },
  { label: __("Trash"), to: "/drive/trash", icon: "lucide-trash-2" },
];
</script>
