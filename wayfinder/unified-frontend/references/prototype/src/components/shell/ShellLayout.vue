<!--
  The suite shell: a workspace bar across the top, the app list down the left,
  and open apps as tabs above the content.

  Three bands, three questions, each answered once. The top bar says which
  workspace everything below it belongs to. The sidebar says which app. The
  tab strip says which of the apps you have open you are looking at. Nothing
  in the chrome switches what a list *is* — there is no lens — so the sidebar
  header carries the suite's mark instead, which doubles as the way home.

  Each app then owns its own header and its own secondary panel (see
  AppSplit), because a mailbox list and a mini month belong to Mail and
  Calendar, not to the shell.

  Below the mobile breakpoint the sidebar and the tabs are gone entirely: apps
  move into a bottom MobileNav, and each app's panel into a BottomSheet.
-->
<template>
  <template v-if="!isMobile">
    <SuiteTopBar />

    <div class="relative flex min-h-0 flex-1">
      <AppRail v-if="sidebarOpen" />

      <!-- Unpinned: a hot strip down the window's left edge. It grows to the
           rail's own width while the rail is out, so the pointer never leaves
           the zone that is holding it open. The strip lives inside this row,
           which starts below the top bar — so the rail slides out under the
           workspace switcher and can never cover it. -->
      <div
        v-else
        class="absolute inset-y-0 left-0 z-30"
        :class="railPeek ? 'w-64' : 'w-2'"
        @mouseenter="railPeek = true"
        @mouseleave="railPeek = false"
      >
        <Transition
          enter-active-class="transition duration-150 ease-out"
          enter-from-class="-translate-x-3 opacity-0"
          leave-active-class="transition duration-100 ease-in"
          leave-to-class="-translate-x-3 opacity-0"
        >
          <div v-if="railPeek" class="h-full p-1.5">
            <AppRail floating />
          </div>
        </Transition>
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <TabStrip />
        <!-- The wrapper owns the layout, not the area: most areas are
             multi-root (a header plus a body), and a class on those lands
             nowhere. -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <component :is="areaComponent" />
        </div>
      </div>
    </div>
  </template>

  <MobileShell v-else class="prototype-shell-mobile h-full">
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <component :is="areaComponent" />
    </div>

    <!-- The app's own panel, surfaced on demand instead of pinned beside it. -->
    <BottomSheet v-model:open="mobileSheetOpen" :title="sheetTitle">
      <div class="flex max-h-[70vh] min-h-0 flex-col">
        <ContextualPanelBody />
      </div>
    </BottomSheet>

    <template #nav>
      <MobileNav>
        <MobileNavItem
          v-for="item in NAV_ITEMS"
          :key="item.id"
          :label="item.label"
          :to="areaTo(item.id)"
          :active="activeApp === item.id"
        >
          <span :class="[item.icon, 'size-5']" aria-hidden="true" />
        </MobileNavItem>
        <MobileNavItem label="More" @click="mobileSheetOpen = true">
          <span class="lucide-ellipsis size-5" aria-hidden="true" />
        </MobileNavItem>
      </MobileNav>
    </template>
  </MobileShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BottomSheet, MobileNav, MobileNavItem, MobileShell } from 'frappe-ui'

import AppPlaceholder from './areas/AppPlaceholder.vue'
import CalendarArea from './areas/CalendarArea.vue'
import DocArea from './areas/DocArea.vue'
import FilesArea from './areas/FilesArea.vue'
import HomeArea from './areas/HomeArea.vue'
import MailArea from './areas/MailArea.vue'
import { NAV_ITEMS } from './fixtures'
import AppRail from './parts/AppRail.vue'
import ContextualPanelBody from './parts/ContextualPanelBody.vue'
import SuiteTopBar from './parts/SuiteTopBar.vue'
import TabStrip from './parts/TabStrip.vue'
import { isMobile } from './useIsMobile'
import { mobileSheetOpen } from './useMobileSheet'
import { useShellNav } from './useShellNav'
import { useShellShortcuts } from './useShellShortcuts'
import { railPeek, sidebarOpen } from './useSidebar'
import { useTabRouting } from './useTabs'

const { area, areaTo } = useShellNav()
const { openApp } = useTabRouting()

// Cmd+1..4 opens an app the same way its sidebar row does, so the shortcut
// lands in that app's tab rather than hijacking whichever tab is in front.
useShellShortcuts(openApp)

// An open document keeps Drive lit, which is where it was opened from.
const activeApp = computed(() => (area.value === 'doc' ? 'files' : area.value))

const sheetTitle = computed(() => {
  if (area.value === 'mail') return 'Mailboxes'
  if (area.value === 'calendar') return 'Calendars'
  return 'Drive'
})

// The apps the prototype actually builds. Everything else in the sidebar is
// named but unbuilt, and lands on the placeholder.
const BUILT_AREAS = {
  home: HomeArea,
  files: FilesArea,
  mail: MailArea,
  calendar: CalendarArea,
  doc: DocArea,
}

const areaComponent = computed(() => BUILT_AREAS[area.value] ?? AppPlaceholder)
</script>
