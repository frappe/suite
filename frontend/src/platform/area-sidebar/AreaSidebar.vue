<!--
  An area page's own sidebar [T010]. The page renders it, so a page may draw no
  sidebar, one, or one on a single child route.

  Desktop: the sidebar teleports into the shell's sidebar slot, beside the page
  header rather than under it. Its width is fixed, so an area switch never moves
  the content pane. Phone: the same body opens in a bottom sheet when the
  shell's bottom nav or the page header sends `openAreaSidebar(area)`.

  Content inside `<AreaSidebarFooter>` sits below the body. On desktop it stays
  pinned to the bottom while the body scrolls. The `actions` slot sits beside
  the title on desktop, for the area's own menu.
-->
<template>
  <Teleport v-if="!isPhone" defer :to="`#${AREA_SIDEBAR_TARGET_ID}`">
    <Sidebar
      :width="AREA_SIDEBAR_WIDTH"
      :collapsible="false"
      role="complementary"
      :aria-label="title"
      :data-area-sidebar="area"
      class="border-r border-outline-gray-1"
    >
      <div class="flex h-12 shrink-0 items-center justify-between gap-2 pl-4 pr-2">
        <span class="truncate text-lg font-semibold text-ink-gray-9">{{ title }}</span>
        <slot name="actions" />
      </div>
      <div class="relative min-h-0 flex-1">
        <ScrollArea ref="scrollArea" class="h-full" viewport-class="px-2 pt-0.5 pb-10">
          <div v-if="loading" v-bind="skeletonAttrs">
            <Skeleton v-for="row in SKELETON_ROWS" :key="row" class="h-7 rounded-4" />
          </div>
          <slot v-else />
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
      <div ref="footer" class="shrink-0 px-2 pb-2 empty:hidden" />
    </Sidebar>
  </Teleport>

  <!-- The sheet's rows are sized for a thumb (see the style below). A steady sheet keeps one
       height, so a section opening or folding scrolls inside it instead of moving its top edge. -->
  <BottomSheet v-else v-model:open="sheetOpen" :title="sheetTitle ? title : undefined">
    <div
      :data-area-sidebar="area"
      class="area-sidebar-sheet px-3"
      :class="[
        sheetFlush ? 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]' : 'pb-8',
        { 'h-[70dvh]': steadySheet, 'pt-3': !sheetTitle && !sheetFlush },
      ]"
    >
      <div v-if="loading" v-bind="skeletonAttrs">
        <Skeleton v-for="row in SKELETON_ROWS" :key="row" class="h-7 rounded-4" />
      </div>
      <slot v-else />
      <div ref="footer" class="mt-4 empty:hidden" />
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { BottomSheet, ScrollArea, Sidebar, Skeleton } from 'frappe-ui'
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
  watchEffect,
  type ComponentPublicInstance,
} from 'vue'
import { useRoute } from 'vue-router'

import { showSettings } from '@/platform/settings'

import {
  AREA_SIDEBAR_FOOTER_KEY,
  AREA_SIDEBAR_TARGET_ID,
  isPhone,
  OPEN_AREA_SIDEBAR_EVENT,
  trackAreaSidebar,
  type OpenAreaSidebarDetail,
} from './state'

const props = withDefaults(
  defineProps<{
    /** The area id the shell's bottom nav names in `openAreaSidebar`. */
    area: string
    /** Visible title, sheet title and landmark name. */
    title: string
    /** Shows the fixed-size skeleton in place of the body. */
    loading?: boolean
    /** Whether the phone's sheet shows the title above the body. */
    sheetTitle?: boolean
    /** The phone's sheet keeps one height, whatever its sections show. */
    steadySheet?: boolean
    /** The phone's sheet leaves the body's top to the body, as a row of tiles spaces its own. */
    sheetFlush?: boolean
  }>(),
  { loading: false, sheetTitle: true, steadySheet: false, sheetFlush: false },
)

defineSlots<{ default?: () => unknown; actions?: () => unknown }>()

const AREA_SIDEBAR_WIDTH = '14rem'
const SKELETON_ROWS = 5
const skeletonAttrs = { class: 'space-y-0.5', 'aria-busy': true, 'data-area-sidebar-skeleton': '' }

const route = useRoute()
const sheetOpen = ref(false)
const footer = ref<HTMLElement | null>(null)
provide(AREA_SIDEBAR_FOOTER_KEY, footer)

watchEffect((onCleanup) => onCleanup(trackAreaSidebar(props.area)))

function onOpenRequest(event: Event) {
  const detail = (event as CustomEvent<Partial<OpenAreaSidebarDetail>>).detail
  if (!isPhone.value || detail?.area !== props.area) return
  sheetOpen.value = true
}
onMounted(() => window.addEventListener(OPEN_AREA_SIDEBAR_EVENT, onOpenRequest))
onBeforeUnmount(() => window.removeEventListener(OPEN_AREA_SIDEBAR_EVENT, onOpenRequest))

// The sheet exists only on a phone. Close it when the layout leaves the phone
// width, or it reopens without input when the layout comes back.
watch(isPhone, (phone) => {
  if (!phone) sheetOpen.value = false
})

// A destination chosen inside the sheet navigates. Close the sheet with it, or
// it covers the page the person just asked for.
watch(
  () => route.fullPath,
  () => {
    sheetOpen.value = false
  },
)

// Settings opens over the page without navigating. Close the sheet, or it
// stays on top of Settings.
watch(showSettings, (open) => {
  if (open) sheetOpen.value = false
})

// Fades show that the body scrolls past either edge.
type ScrollAreaInstance = ComponentPublicInstance & { viewportElement?: HTMLElement | null }
const scrollArea = ref<ScrollAreaInstance | null>(null)
const fadeTop = ref(false)
const fadeBottom = ref(false)
let viewport: HTMLElement | null = null
let resizeObserver: ResizeObserver | null = null

function updateFades() {
  fadeTop.value = !!viewport && viewport.scrollTop > 0
  fadeBottom.value =
    !!viewport && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
}

function bindViewport(next: HTMLElement | null) {
  if (viewport === next) return
  viewport?.removeEventListener('scroll', updateFades)
  resizeObserver?.disconnect()
  resizeObserver = null
  viewport = next
  if (viewport) {
    viewport.addEventListener('scroll', updateFades, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateFades)
      resizeObserver.observe(viewport)
      if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild)
    }
  }
  updateFades()
}

watch(
  scrollArea,
  () => void nextTick(() => bindViewport(scrollArea.value?.viewportElement ?? null)),
  {
    flush: 'post',
  },
)
onBeforeUnmount(() => bindViewport(null))
</script>

<style scoped>
/* On a phone the sidebar's rows are a sheet's, sized as develop's folders sheet was (measured
   against it): 38px rows (10px above and below a body-size label), the icon 24px in from the
   sheet's edge, the label 12px after it, and 18px icons. The sheet is white, so the open row is
   the gray of a pressed one, in bold, not the sidebar's raised white card, which read as nothing
   selected. */
.area-sidebar-sheet :deep([data-slot='sidebar-item']) {
  @apply h-auto rounded-6 py-2.5 pr-1;
}
/* Headings start where the icons do. */
.area-sidebar-sheet :deep([data-slot='sidebar-section'] > .px-2) {
  @apply px-3;
}
.area-sidebar-sheet :deep([data-slot='sidebar-item'] > :is(a, button)) {
  @apply pl-3;
}
.area-sidebar-sheet :deep([data-slot='sidebar-item'] .ml-2) {
  @apply ml-3;
}
.area-sidebar-sheet :deep([data-slot='sidebar-item'] svg),
.area-sidebar-sheet :deep([data-slot='sidebar-item'] [class*='lucide-']) {
  @apply size-[18px];
}
.area-sidebar-sheet :deep([data-slot='sidebar-item'] .text-sm) {
  @apply text-base;
}
.area-sidebar-sheet :deep([data-slot='sidebar-item'][data-state='active']) {
  @apply bg-surface-gray-2 shadow-none;
}
/* The label's text style sets its own weight, so the bold goes on the label itself. */
.area-sidebar-sheet :deep([data-slot='sidebar-item'][data-state='active'] .text-sm) {
  @apply font-semibold;
}
</style>
