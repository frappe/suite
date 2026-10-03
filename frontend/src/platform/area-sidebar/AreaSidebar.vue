<!--
  An area page's own sidebar [T010]. The page renders it, so a page may draw no
  sidebar, one, or one on a single child route.

  Desktop: the sidebar teleports into the shell's sidebar slot, beside the page
  header rather than under it. Its width is fixed, so an area switch never moves
  the content pane. Phone: the same body opens in a bottom sheet when the
  shell's bottom nav or the page header sends `openAreaSidebar(area)`.

  Content inside `<AreaSidebarFooter>` sits below the body. On desktop it stays
  pinned to the bottom while the body scrolls.
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
      <div class="flex h-12 shrink-0 items-center px-4">
        <span class="truncate text-lg font-semibold text-ink-gray-9">{{ title }}</span>
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

  <BottomSheet v-else v-model:open="sheetOpen" :title="title">
    <div :data-area-sidebar="area" class="px-2 pb-8">
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
  }>(),
  { loading: false },
)

defineSlots<{ default?: () => unknown }>()

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
