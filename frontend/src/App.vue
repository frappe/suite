<template>
  <FeedbackProvider>
    <ShellLayout
      :areas="registry.areas.value"
      :all-areas="registry.allAreas"
      :badges="registry.badges.value"
    >
      <router-view />
      <template #bell>
        <NotificationsBell />
      </template>
    </ShellLayout>
  </FeedbackProvider>
</template>

<script setup lang="ts">
import { defineAsyncComponent, provide } from "vue";

import { useAppRegistry } from "@/composition/appRegistry";
import { documentTypes } from "@/composition/documentRegistry";
import { DOCUMENT_TYPES_KEY } from "@/platform/contracts";

const FeedbackProvider = defineAsyncComponent(() =>
  import("@/platform/feedback").then(
    ({ FeedbackProvider }) => FeedbackProvider,
  ),
);
const ShellLayout = defineAsyncComponent(
  () => import("@/shell/ShellLayout.vue"),
);
const NotificationsBell = defineAsyncComponent(
  () => import("@/composition/notifications/NotificationsBell.vue"),
);
const registry = useAppRegistry();
provide(DOCUMENT_TYPES_KEY, documentTypes);
</script>
