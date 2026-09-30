<template>
  <!--
    A guest reads "Ravi (Acme) · Guest", or "Guest" with no name (spec §10.5).
    Only the name truncates, so the marker always shows. The name is isolated,
    so bidi controls in it cannot move the marker.
  -->
  <span class="flex min-w-0 items-baseline gap-1">
    <template v-if="author === 'Guest'">
      <!-- The flex layout drops the space after the name. Copied text and screen readers keep it. -->
      <template v-if="authorName"><bdi dir="auto" class="min-w-0 truncate" data-part="name">{{ authorName }}</bdi>{{ " " }}</template>
      <span class="shrink-0" data-part="marker">{{ authorName ? `· ${__("Guest")}` : __("Guest") }}</span>
    </template>
    <span v-else class="min-w-0 truncate"><slot /></span>
  </span>
</template>

<script setup lang="ts">
import { translate as __ } from "@/platform/translation";

defineProps<{
  /** The comment's `author`: a user id, or "Guest" for a visitor without a session. */
  author: string | null;
  /** The name a guest typed. */
  authorName: string | null;
}>();

/** The label for a signed-in author. Each product keeps its own. */
defineSlots<{ default?: () => unknown }>();
</script>
