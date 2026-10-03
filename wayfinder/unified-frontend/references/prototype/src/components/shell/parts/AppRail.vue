<!--
  The app rail. With the apps living here rather than in an icon strip, it is
  one thing only: which app am I in.

  Its header strip is where a lens switcher would sit. It holds the Suite mark
  instead, which doubles as the way home — one identity, one destination, no
  second nav system stacked on the first.

  Two states, one component. Pinned, it holds a column of its own and pushes
  the content across. Unpinned, the shell renders it `floating` over the
  content while the pointer is at the left edge, and the same header button
  pins it back rather than moving to the top of the window.
-->
<template>
  <div
    class="flex h-full w-60 flex-col bg-surface-gray-1"
    :class="[
      floating ? 'rounded-5 shadow-md' : 'shrink-0',
      // In the fill variant the app's own sidebar wears the same gray, so the
      // rail needs a hairline to keep the two from reading as one slab. The
      // stroke variant leaves them separated by tone alone, and the floating
      // rail by its own rounded edge.
      !floating && panelStyle === 'fill' && 'border-r border-outline-gray-1',
    ]"
  >
    <div class="flex h-12 shrink-0 items-center gap-1 px-2">
      <button
        type="button"
        class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-4 px-1.5 transition hover:bg-surface-gray-3"
        :class="isHome && 'bg-surface-gray-3'"
        @click="openApp('home')"
      >
        <SuiteLogo class="size-5 shrink-0" />
        <span class="min-w-0 flex-1 truncate text-left text-base font-medium text-ink-gray-8">
          Suite
        </span>
      </button>
      <Tooltip :content="floating ? 'Pin rail' : 'Hide rail'" placement="bottom">
        <Button
          variant="ghost"
          icon="lucide-panel-left"
          :aria-label="floating ? 'Pin rail' : 'Hide rail'"
          @click="toggle"
        />
      </Tooltip>
    </div>

    <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-4">
      <div class="flex h-7 items-center">
        <SidebarLabel>Pinned apps</SidebarLabel>
      </div>
      <nav class="mt-0.5 space-y-0.5">
        <SidebarItem
          v-for="app in APPS"
          :key="app.id"
          :label="app.label"
          :icon="app.icon"
          :active="app.id === activeApp"
          :suffix="app.id === 'mail' && inboxUnread ? String(inboxUnread) : undefined"
          @click="openApp(app.id)"
        />
      </nav>

      <div class="mt-2 border-t border-outline-gray-1 pt-2">
        <SidebarItem label="All apps" icon="lucide-layout-grid" @click="() => {}" />
      </div>
    </ScrollArea>

    <div class="shrink-0 px-2 pb-2">
      <Dropdown :options="ACCOUNT_OPTIONS" align="start" match-trigger-width>
        <button
          type="button"
          class="flex h-10 w-full min-w-0 items-center gap-2 rounded-4 px-1.5 transition hover:bg-surface-gray-3"
        >
          <Avatar size="sm" :image="USER.avatar" :label="USER.name" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-8">
            {{ USER.name }}
          </span>
          <Badge label="Free" theme="gray" variant="subtle" class="shrink-0" />
          <span
            class="lucide-chevrons-up-down size-4 shrink-0 text-ink-gray-5"
            aria-hidden="true"
          />
        </button>
      </Dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  ScrollArea,
  SidebarItem,
  SidebarLabel,
  Tooltip,
} from 'frappe-ui'

import { ACCOUNT_OPTIONS } from '../accountMenu'
import { APPS, USER } from '../fixtures'
import { unreadIn } from '../mailFixtures'
import { panelStyle } from '../usePanelStyle'
import { useShellNav } from '../useShellNav'
import { railPeek, sidebarOpen } from '../useSidebar'
import { useTabRouting } from '../useTabs'
import SuiteLogo from './SuiteLogo.vue'

const props = defineProps<{
  /** Rendered over the content on hover, rather than pinned in the layout. */
  floating?: boolean
}>()

const { area } = useShellNav()
const { openApp } = useTabRouting()

const isHome = computed(() => area.value === 'home')

// The list has no doc row, so an open document keeps Drive lit — which is
// where it was opened from.
const activeApp = computed(() => (area.value === 'doc' ? 'files' : area.value))

// Derived from the same fixture rows the Mail list renders, so the badge and
// the mailbox counts can never disagree.
const inboxUnread = computed(() => unreadIn('inbox'))

// One button, both directions: hidden, it is how you pin the rail back;
// pinned, it is how you hide it. Either way it stays in the rail's own
// header rather than moving up beside the workspace.
function toggle() {
  if (props.floating) {
    sidebarOpen.value = true
    railPeek.value = false
    return
  }
  sidebarOpen.value = false
}

</script>
