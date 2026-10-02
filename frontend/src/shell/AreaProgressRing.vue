<template>
  <!-- Absolute over the item's icon, so the item never changes size. -->
  <span class="pointer-events-none absolute inset-0">
    <!-- The item's link carries its own aria-label, so the state is a live
         region: screen readers hear it when it changes. Always rendered, as a
         live region must exist before its text changes. -->
    <span data-slot="area-progress-status" role="status" class="sr-only">{{ status }}</span>
    <Transition
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-500"
      leave-to-class="opacity-0"
    >
      <svg
        v-if="progress?.fraction != null"
        data-slot="area-progress-ring"
        :data-tone="progress.tone"
        :class="ringClass"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle cx="12" cy="12" :r="RADIUS" stroke="currentColor" stroke-width="2" class="text-ink-gray-2" />
        <circle
          cx="12"
          cy="12"
          :r="RADIUS"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="CIRCUMFERENCE * (1 - clamped)"
          class="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
          :class="toneClass"
        />
      </svg>
    </Transition>
    <span
      v-if="progress?.attention"
      data-slot="area-progress-attention"
      aria-hidden="true"
      class="absolute -right-0.5 -top-0.5 block size-2 rounded-full border border-[var(--surface-base)] bg-surface-red-6"
    />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { progressState, type AreaProgress } from "@/shell/areaProgress";

const props = defineProps<{
  progress: AreaProgress | null;
  /**
   * The icon the ring goes around: 16 px (the guest frame's Uploads button),
   * 22 px (a rail area) or 24 px (a bottom-nav area).
   */
  around: 16 | 22 | 24;
  /** The area's name, spoken before the state: "Files: Paused". */
  label: string;
}>();

const RADIUS = 10.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const status = computed(() => {
  const state = progressState(props.progress);
  return state ? `${props.label}: ${state}` : "";
});
const clamped = computed(() =>
  Math.min(1, Math.max(0, props.progress?.fraction ?? 0)),
);
const ringClass = computed(
  () => ({ 16: "size-6", 22: "size-7", 24: "size-8" })[props.around],
);
const toneClass = computed(
  () =>
    ({
      running: "text-ink-gray-7",
      paused: "text-ink-amber-6",
      done: "text-ink-green-6",
    })[props.progress?.tone ?? "running"],
);
</script>
