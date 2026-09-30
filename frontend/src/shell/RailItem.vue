<template>
  <FrappeRailItem
    :label="label"
    :description="description ?? progressDescription"
    :route="to"
    :active="resolvedActive"
    :badge="hasBadgeSlot ? 0 : badge"
    :badge-style="badgeStyle"
    :variant="variant"
    @click="$emit('click', $event)"
  >
    <span class="relative grid size-4 place-items-center">
      <component :is="icon" v-if="icon" class="size-4" aria-hidden="true" />
      <slot v-else />
      <AreaProgressRing :progress="progress" size="rail" />
      <span v-if="hasBadgeSlot" class="absolute -right-2.5 -top-2.5">
        <slot name="badge" />
      </span>
    </span>
  </FrappeRailItem>
</template>

<script setup lang="ts">
import { computed, useSlots, type Component } from "vue";
import { SidebarRailItem as FrappeRailItem } from "frappe-ui";
import { useRoute, type RouteLocationRaw } from "vue-router";

import { translate as __ } from "@/platform/translation";
import AreaProgressRing from "@/shell/AreaProgressRing.vue";
import type { AreaProgress } from "@/shell/areaProgress";

const props = withDefaults(
  defineProps<{
    label: string;
    description?: string;
    icon?: Component;
    to?: RouteLocationRaw;
    area?: string;
    active?: boolean;
    badge?: number;
    badgeStyle?: "count" | "dot";
    variant?: "subtle" | "ghost";
    /** Background work of this item's area, drawn as a ring around the icon. */
    progress?: AreaProgress | null;
  }>(),
  {
    active: undefined,
    badge: 0,
    badgeStyle: "count",
    variant: "ghost",
    progress: null,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();

const route = useRoute();
const slots = useSlots();
const hasBadgeSlot = computed(() => Boolean(slots.badge));
const progressDescription = computed(() => {
  const progress = props.progress;
  if (!progress) return undefined;
  if (progress.attention) return __("Needs attention");
  if (progress.tone === "paused") return __("Paused");
  if (progress.tone === "done") return __("Done");
  return progress.fraction == null
    ? undefined
    : __("{0}% done", [Math.round(progress.fraction * 100)]);
});
// The item is active on every route its area's route group holds, also on a
// child that clears `area` to skip the capability gate (Mail's admin dashboard).
const resolvedActive = computed(
  () =>
    props.active ??
    (props.area
      ? route.matched.some((record) => record.meta.area === props.area)
      : false),
);
</script>
