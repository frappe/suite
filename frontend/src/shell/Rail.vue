<template>
  <FrappeRail class="suite-rail !w-14 !border-r !border-outline-gray-1 !p-0">
    <!-- The workspace's mark: its logo, else its initial. A site that has not
         named its workspace yet shows the Suite logo. The row matches the page
         header's height, and its divider spans only the items' column. -->
    <div
      class="mx-[11px] flex h-12 shrink-0 items-center justify-center self-stretch border-b border-outline-gray-1"
    >
      <Avatar
        :image="workspaceMark"
        :label="workspaceName"
        shape="square"
        size="xl"
        role="img"
        :aria-label="workspaceName || 'Suite'"
        :title="workspaceName || 'Suite'"
      />
    </div>
    <div class="relative min-h-0 w-full flex-1">
      <ScrollArea
        ref="areaScroll"
        class="h-full w-full"
        viewport-class="px-[11px] pb-2.5 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <nav class="flex flex-col items-center gap-1" :aria-label="__('Areas')">
          <RailItem
            v-for="area in areas"
            :key="area.id"
            :area="area.id"
            :label="area.label()"
            :icon="area.icon"
            :to="area.to"
            :badge="badges[area.id] ?? 0"
            badge-style="dot"
            :progress="areaProgress?.progress(area.id) ?? null"
            @click="openProgress(area.id)"
          />
          <!-- Search reaches every area at once, so it closes the rail's list of
               areas rather than sitting in each area's sidebar. -->
          <RailItem
            :label="__('Search')"
            :description="searchShortcut"
            :icon="SearchIcon"
            @click="root.paletteOpen = true"
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

    <div class="flex shrink-0 flex-col items-center gap-1 px-[11px] pb-3 pt-2">
      <!-- The bell is a plain Button (it triggers a popover), so this wrapper
           lets the styles below size and ink it like the items around it. It
           also holds the bell's 34 px while the async component loads, so the
           group below does not move once the bell arrives. -->
      <div class="rail-bell flex min-h-[34px]">
        <slot name="bell" />
      </div>
      <RailItem :label="__('Settings')" variant="ghost" @click="openSettings()">
        <span class="lucide-settings size-4" aria-hidden="true" />
      </RailItem>
      <AccountMenu rail />
    </div>
  </FrappeRail>
</template>

<script setup lang="ts">
import { Avatar, SidebarRail as FrappeRail, ScrollArea } from 'frappe-ui'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'

import type { AreaDefinition } from '@/platform/contracts'
import AccountMenu from '@/shell/AccountMenu.vue'
import { useAreaProgress } from '@/shell/areaProgress'
import RailItem from '@/shell/RailItem.vue'
import SearchIcon from '@/shell/SearchIcon.vue'
import { openSettings } from '@/shell/settings/useSettingsDialog'
import { useWorkspace } from '@/shell/useWorkspace'
import { useRootStore } from '@/stores/root'

defineProps<{
  areas: readonly AreaDefinition[]
  badges: Readonly<Record<string, number>>
}>()

defineSlots<{ bell?: () => unknown }>()

const suiteLogo = '/assets/suite/frontend/logo.svg'
const { workspaceName, workspaceLogo } = useWorkspace()
const workspaceMark = computed(() => workspaceLogo.value || (workspaceName.value ? '' : suiteLogo))
const areaProgress = useAreaProgress()
const root = useRootStore()
const searchShortcut = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

// The item still navigates to its area. The source opens its own view there.
function openProgress(area: string) {
  if (areaProgress?.progress(area)) areaProgress.open(area)
}

type ScrollAreaInstance = ComponentPublicInstance & {
  viewportElement?: HTMLElement | null
}

const areaScroll = ref<ScrollAreaInstance | null>(null)
const fadeTop = ref(false)
const fadeBottom = ref(false)
let viewport: HTMLElement | null = null
let resizeObserver: ResizeObserver | null = null

function updateFades() {
  if (!viewport) return
  fadeTop.value = viewport.scrollTop > 0
  fadeBottom.value = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
}

function bindViewport(next: HTMLElement | null) {
  if (viewport === next) return
  viewport?.removeEventListener('scroll', updateFades)
  resizeObserver?.disconnect()
  viewport = next
  if (viewport) {
    viewport.addEventListener('scroll', updateFades, { passive: true })
    resizeObserver = new ResizeObserver(updateFades)
    resizeObserver.observe(viewport)
    if (viewport.firstElementChild) resizeObserver.observe(viewport.firstElementChild)
  }
  updateFades()
}

onMounted(() => void nextTick(() => bindViewport(areaScroll.value?.viewportElement ?? null)))
watch(
  areaScroll,
  () => void nextTick(() => bindViewport(areaScroll.value?.viewportElement ?? null)),
)
onBeforeUnmount(() => bindViewport(null))
</script>

<style scoped>
/* The rail is 56 px and its items 34 px, so each 22 px area icon sits with
   room around it. Idle items step back to gray-5 and hover to gray-7, so the
   active item is the only full-strength mark. SidebarRailItem fixes its size
   and ink and takes no class, so both are set here by its data attributes,
   and the bell gets the same treatment. */
.suite-rail :deep([data-slot='sidebar-rail-item']),
.rail-bell > :deep(button) {
  width: 34px;
  height: 34px;
}
.suite-rail :deep([data-slot='sidebar-rail-item'][data-state='inactive']),
.rail-bell > :deep(button:not([aria-expanded='true'])) {
  color: var(--ink-gray-5);
}
.suite-rail :deep([data-slot='sidebar-rail-item'][data-state='inactive']:hover),
.rail-bell > :deep(button:not([aria-expanded='true']):hover) {
  color: var(--ink-gray-7);
}
</style>
