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
    <!-- An area's duotone icon is drawn at 22 px; a slotted utility icon
         (Settings) stays a 16 px Lucide glyph. -->
    <span
      class="relative grid place-items-center"
      :class="icon ? 'size-[22px]' : 'size-4'"
    >
      <component :is="icon" v-if="icon" class="size-[22px]" aria-hidden="true" />
      <slot v-else />
      <AreaProgressDot :progress="progress" :label="label" />
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

import AreaProgressDot from "@/shell/AreaProgressDot.vue";
import { progressDetail, type AreaProgress } from "@/shell/areaProgress";

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
    /** Background work of this item's area, drawn as a dot on the icon. */
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
const progressDescription = computed(() => progressDetail(props.progress));
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
