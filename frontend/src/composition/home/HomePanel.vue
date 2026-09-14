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
      :to="item.to"
    />
  </nav>
</template>

<script setup lang="ts">
import { SidebarItem, SidebarLabel } from "frappe-ui";

import { translate as __ } from "@/platform/translation";

const destinations = [
  { label: __("All files"), to: "/files", icon: "lucide-folder" },
  {
    label: __("Shared with me"),
    to: "/files/shared-with-me",
    icon: "lucide-users",
  },
  { label: __("Starred"), to: "/files/starred", icon: "lucide-star" },
  { label: __("Trash"), to: "/files/trash", icon: "lucide-trash-2" },
];
</script>
