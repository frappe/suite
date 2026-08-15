<!--
  PROTOTYPE — remove. The decided shell: a thin always-visible icon rail plus a
  contextual panel whose content follows the active area.

  The rail and panel geometry is copied from Gameplan (frappe-bench/apps/
  gameplan AppRail.vue + AppSidebar.vue) so the two shells match pixel for
  pixel: the rail owns the border between it and the panel, the panel's header
  region is a p-1.5 box, and its body is a ScrollArea padded px-2 pt-0.5 pb-10.
  The border between the panel and the page comes from the content slot, which
  only scoped CSS can reach.
-->
<template>
  <DesktopShell :scroll="isOverview" class="prototype-shell h-full">
    <template #rail>
      <Rail class="border-r">
        <!-- Cancel Rail's own top padding and stand exactly one PageHeader tall
             (min-h-12), so the divider below the logo continues the header's
             bottom border across the rail. -->
        <div class="-mt-2.5 flex h-12 shrink-0 items-center justify-center">
          <img :src="suiteLogo" alt="Frappe Suite" class="size-7" />
        </div>

        <div class="flex w-full shrink-0 flex-col items-center gap-0.5 border-t pt-3">
          <RailItem
            v-for="item in NAV_ITEMS"
            :key="item.id"
            :label="item.label"
            :icon="item.icon"
            variant="ghost"
            :to="areaTo(item.id)"
            :active="area === item.id"
            :badge="item.id === 'mail' ? 12 : undefined"
          />
        </div>

        <div class="flex-1" />

        <div class="flex w-full shrink-0 flex-col items-center gap-0.5">
          <RailItem label="Notifications" icon="lucide-bell" variant="ghost" />
          <!-- The prototype needs its own way into dark mode: the suite's
               index.html sets data-theme from an unrendered Jinja expression,
               so nothing else resolves the theme under the dev server. -->
          <RailItem
            :label="resolvedTheme === 'dark' ? 'Switch to light' : 'Switch to dark'"
            :icon="resolvedTheme === 'dark' ? 'lucide-sun' : 'lucide-moon'"
            variant="ghost"
            @click="toggleTheme"
          />
          <RailItem label="Settings" icon="lucide-settings" variant="ghost" />
          <RailItem :label="USER.name" variant="ghost">
            <Avatar size="sm" :image="USER.avatar" :label="USER.name" />
          </RailItem>
        </div>
      </Rail>
    </template>

    <template #sidebar>
      <Sidebar disable-collapse width="14rem">
        <div class="flex shrink-0 items-center p-1.5">
          <WorkspaceSwitcher />
        </div>

        <!--
          The app owns the scroll region: frappe-ui's ScrollArea keeps the thin,
          auto-hiding overlay scrollbar; padding the viewport gives the active
          row's shadow room so overflow-hidden doesn't clip it.
        -->
        <ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-0.5 pb-10">
          <template v-if="isOverview">
            <div class="flex h-7 items-center justify-between">
              <SidebarLabel>Folders</SidebarLabel>
            </div>
            <nav class="mt-0.5 space-y-0.5">
              <SidebarItem
                v-for="item in FOLDERS"
                :key="item.id"
                :label="item.label"
                :icon="item.icon"
                :to="areaTo('files', item.id)"
                :active="folder === item.id"
              />
            </nav>
          </template>

          <template v-else-if="area === 'mail'">
            <div class="flex h-7 items-center justify-between">
              <SidebarLabel>Mailboxes</SidebarLabel>
            </div>
            <MailboxList class="mt-0.5" />
          </template>

          <template v-else>
            <MiniMonth />
            <div class="flex h-7 items-center justify-between">
              <SidebarLabel>My calendars</SidebarLabel>
            </div>
            <nav class="mt-0.5 space-y-0.5">
              <SidebarItem v-for="cal in CALENDARS" :key="cal.id" :label="cal.label">
                <!-- The dot sits in the same 16px box an icon would, so the
                     labels line up with every other row in the panel. -->
                <template #prefix>
                  <span class="grid size-4 place-items-center">
                    <span class="size-2.5 rounded-full" :class="cal.dot" />
                  </span>
                </template>
              </SidebarItem>
            </nav>
          </template>
        </ScrollArea>
      </Sidebar>
    </template>

    <component :is="areaComponent" />
  </DesktopShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Avatar,
  DesktopShell,
  Rail,
  RailItem,
  ScrollArea,
  Sidebar,
  SidebarItem,
  SidebarLabel,
  useTheme,
} from 'frappe-ui'

import suiteLogo from '@/assets/app-logos/suite.svg'

import CalendarArea from './areas/CalendarArea.vue'
import FilesArea from './areas/FilesArea.vue'
import HomeArea from './areas/HomeArea.vue'
import MailArea from './areas/MailArea.vue'
import { CALENDARS, FOLDERS, NAV_ITEMS, USER } from './fixtures'
import MailboxList from './parts/MailboxList.vue'
import MiniMonth from './parts/MiniMonth.vue'
import WorkspaceSwitcher from './parts/WorkspaceSwitcher.vue'
import { useShellNav } from './useShellNav'

const { area, folder, areaTo } = useShellNav()
const { currentTheme, setTheme, getSystemTheme } = useTheme()

// currentTheme starts at 'system', so both the label and the toggle have to go
// by the theme the page is actually showing. frappe-ui's own toggleTheme
// compares the stored preference, which turns the first click on a
// system-dark page into a no-op.
const resolvedTheme = computed(() =>
  currentTheme.value === 'system' ? getSystemTheme() : currentTheme.value,
)

function toggleTheme() {
  setTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark')
}

const isOverview = computed(() => area.value === 'home' || area.value === 'files')

const AREA_COMPONENTS = {
  home: HomeArea,
  files: FilesArea,
  mail: MailArea,
  calendar: CalendarArea,
}
const areaComponent = computed(() => AREA_COMPONENTS[area.value])
</script>

<style scoped>
.prototype-shell :deep([data-slot='desktop-shell-content']) {
  @apply border-l bg-surface-base;
}
</style>
