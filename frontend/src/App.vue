<template>
  <FeedbackProvider>
    <ShellLayout
      :areas="registry.areas.value"
      :all-areas="registry.allAreas"
      :badges="registry.badges.value"
    >
      <router-view />
    </ShellLayout>
  </FeedbackProvider>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";

import { useAppRegistry } from "@/composition/appRegistry";

const FeedbackProvider = defineAsyncComponent(() =>
  import("@/platform/feedback").then(
    ({ FeedbackProvider }) => FeedbackProvider,
  ),
);
const ShellLayout = defineAsyncComponent(
  () => import("@/shell/ShellLayout.vue"),
);
const registry = useAppRegistry();
</script>
