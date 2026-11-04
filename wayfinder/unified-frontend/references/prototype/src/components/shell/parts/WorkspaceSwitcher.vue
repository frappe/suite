<!--
  Workspace switcher, top left. It scopes everything under it — the app list,
  the search, every tab — so it sits above all of them rather than inside any
  one app's panel.

  Look comes from the Figma frame (204:26718): 193px, no fill closed, gray on
  hover, a 12px card on click carrying elevation/light/base.

  Motion is traced off the Coline recording, frame by frame at 60fps, and the
  shape of the markup follows from it. The pill does not hand over to a
  separate menu — it *becomes* one: one card, always mounted, growing from the
  row's own height as its background and shadow fade up under it. That is why
  there is no second copy of the workspace row here, and why the chevron can
  rotate through 90° instead of one glyph cross-fading into another.

  Measured from the recording: the card takes ~12 frames (200ms) to open and
  ~4 (70ms) to shut. The asymmetry is deliberate there and kept here — opening
  is the part worth watching, closing should be out of the way.
-->
<template>
  <div ref="root" class="relative h-8 w-[193px]">
    <!-- Inset by its own padding on both axes, so the first row lands exactly
         where the closed pill sits: opening moves the name by nothing. -->
    <div
      ref="card"
      @scroll="resetScroll"
      class="workspace-card absolute -left-1 -right-1 -top-1 z-50 overflow-hidden rounded-[12px] p-1"
      :class="
        open
          ? 'is-open bg-surface-base duration-200 ease-out'
          : 'bg-transparent duration-[70ms] ease-in'
      "
      :style="{ height: `${open ? openHeight : 40}px` }"
    >
      <button
        type="button"
        class="flex h-8 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
        :title="current.name"
        @click="open = !open"
      >
        <WorkspaceMark :workspace="current" class="size-4 text-[10px]" />
        <span class="min-w-0 flex-1 truncate text-left text-base font-medium text-ink-gray-7">
          {{ current.name }}
        </span>
        <span
          class="lucide-chevron-down size-4 shrink-0 text-ink-gray-6 transition-transform"
          :class="open ? 'rotate-180 duration-200 ease-out' : 'duration-[70ms] ease-in'"
          aria-hidden="true"
        />
      </button>

      <!-- Everything under the first row is what the card grows to reveal. It
           fades rather than simply being uncovered, which is what the
           recording shows as the height runs out. -->
      <div
        class="transition-opacity"
        :inert="!open"
        :class="open ? 'opacity-100 duration-200 ease-out' : 'opacity-0 duration-[70ms] ease-in'"
      >
        <button
          v-for="workspace in others"
          :key="workspace.id"
          type="button"
          class="flex h-8 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
          @click="pick(workspace.id)"
        >
          <WorkspaceMark :workspace="workspace" class="size-4 text-[10px]" />
          <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-7">
            {{ workspace.name }}
          </span>
        </button>

        <button
          type="button"
          class="flex h-8 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
          @click="close"
        >
          <span class="lucide-plus size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-7">
            New workspace
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useEventListener } from '@vueuse/core'

import { currentWorkspace as current, workspaceId as currentId, workspaces } from '../workspaceState'
import WorkspaceMark from './WorkspaceMark.vue'

const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const card = useTemplateRef<HTMLElement>('card')

// The card's height is its whole mechanic, so it must never hold a scroll
// offset. `overflow-hidden` stops a person scrolling it but not the browser,
// which scrolls any container to bring a focused descendant into view.
function resetScroll() {
  if (card.value) card.value.scrollTop = 0
}

const others = computed(() => workspaces.value.filter((w) => w.id !== currentId.value))

// Every row is h-8 and the card is p-1, so the open height is arithmetic — no
// measuring, and height can therefore be a plain CSS transition rather than a
// JS one. Rows: the current workspace, any others, then New workspace.
const openHeight = computed(() => 8 + 32 * (2 + others.value.length))

function close() {
  open.value = false
}

function pick(id: string) {
  currentId.value = id
  close()
}

// Dismissal is owned here rather than handed to a directive, so the ordering
// is knowable: `mousedown` lands before the trigger's own click has changed
// any state, and the test is against the wrapper, which never unmounts.
useEventListener(window, 'mousedown', (event: MouseEvent) => {
  if (!open.value) return
  if (!root.value?.contains(event.target as Node)) close()
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (open.value && event.key === 'Escape') close()
})
</script>

<style scoped>
/*
  The card carries no surface at all until it opens, so the closed state is
  the bare row the frame asks for. Background and shadow come up together with
  the height, which is what reads as the pill turning into a menu.

  elevation/light/base is copied from the Figma effect style rather than
  approximated: frappe-ui's scale has nothing at this depth — shadow-sm is
  flatter, shadow-md is a popover and heavier than this card wants.
*/
.workspace-card {
  box-shadow: none;
  transition-property: height, background-color, box-shadow;
}

.workspace-card.is-open {
  box-shadow:
    0 2px 5px rgba(0, 0, 0, 0.14),
    0 0 1.5px rgba(0, 0, 0, 0.16),
    inset 0 0.25px 1.5px rgba(255, 255, 255, 0.08);
}
</style>
