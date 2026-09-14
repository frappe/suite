<template>
  <FrappeRail class="!border-r !border-outline-gray-1 !p-0">
    <div class="relative min-h-0 w-full flex-1">
      <ScrollArea
        ref="areaScroll"
        class="h-full w-full"
        viewport-class="px-[11px] py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <nav class="flex flex-col items-center gap-2" :aria-label="__('Areas')">
          <RailItem
            v-for="area in areas"
            :key="area.id"
            :area="area.id"
            :label="area.label()"
            :icon="area.icon"
            :to="area.to"
            :badge="badges[area.id] ?? 0"
          />
        </nav>
      </ScrollArea>
      <div
        v-if="fadeTop"
        class="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-surface-sidebar to-transparent"
      />
      <div
        v-if="fadeBottom"
        class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface-sidebar to-transparent"
      />
    </div>

    <div class="flex shrink-0 flex-col items-center gap-2 px-[11px] pb-3 pt-2">
      <slot name="bell" />
      <RailItem :label="__('Settings')" variant="ghost" @click="openSettings()">
        <span class="lucide-settings size-4" aria-hidden="true" />
      </RailItem>
      <AccountMenu rail />
    </div>
  </FrappeRail>
</template>

<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { Rail as FrappeRail, ScrollArea } from "frappe-ui";

import type { AreaDefinition } from "@/platform/contracts";
import AccountMenu from "@/shell/AccountMenu.vue";
import RailItem from "@/shell/RailItem.vue";
import { openSettings } from "@/shell/settings/useSettingsDialog";

defineProps<{
  areas: readonly AreaDefinition[];
  badges: Readonly<Record<string, number>>;
}>();

defineSlots<{ bell?: () => unknown }>();

type ScrollAreaInstance = ComponentPublicInstance & {
  viewportElement?: HTMLElement | null;
};

const areaScroll = ref<ScrollAreaInstance | null>(null);
const fadeTop = ref(false);
const fadeBottom = ref(false);
let viewport: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

function updateFades() {
  if (!viewport) return;
  fadeTop.value = viewport.scrollTop > 0;
  fadeBottom.value =
    viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
}

function bindViewport(next: HTMLElement | null) {
  if (viewport === next) return;
  viewport?.removeEventListener("scroll", updateFades);
  resizeObserver?.disconnect();
  viewport = next;
  if (viewport) {
    viewport.addEventListener("scroll", updateFades, { passive: true });
    resizeObserver = new ResizeObserver(updateFades);
    resizeObserver.observe(viewport);
    if (viewport.firstElementChild)
      resizeObserver.observe(viewport.firstElementChild);
  }
  updateFades();
}

onMounted(
  () =>
    void nextTick(() =>
      bindViewport(areaScroll.value?.viewportElement ?? null),
    ),
);
watch(
  areaScroll,
  () =>
    void nextTick(() =>
      bindViewport(areaScroll.value?.viewportElement ?? null),
    ),
);
onBeforeUnmount(() => bindViewport(null));
</script>
