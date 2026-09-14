<template>
  <FrappeRailItem
    :label="label"
    :description="description"
    :to="to"
    :active="resolvedActive"
    :badge="hasBadgeSlot ? 0 : badge"
    :badge-style="badgeStyle"
    :variant="variant"
    @click="$emit('click', $event)"
  >
    <span class="relative grid size-4 place-items-center">
      <component :is="icon" v-if="icon" class="size-4" aria-hidden="true" />
      <slot v-else />
      <span v-if="hasBadgeSlot" class="absolute -right-2.5 -top-2.5">
        <slot name="badge" />
      </span>
    </span>
  </FrappeRailItem>
</template>

<script setup lang="ts">
import { computed, useSlots, type Component } from "vue";
import { RailItem as FrappeRailItem } from "frappe-ui";
import { useRoute, type RouteLocationRaw } from "vue-router";

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
    variant?: "tile" | "ghost";
  }>(),
  {
    active: undefined,
    badge: 0,
    badgeStyle: "count",
    variant: "ghost",
  },
);

defineEmits<{ click: [event: MouseEvent] }>();

const route = useRoute();
const slots = useSlots();
const hasBadgeSlot = computed(() => Boolean(slots.badge));
const resolvedActive = computed(
  () => props.active ?? (props.area ? route.meta.area === props.area : false),
);
</script>
