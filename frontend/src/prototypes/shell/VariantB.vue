<!--
  PROTOTYPE — remove. Variant B "Icon rail": a thin always-visible icon rail
  plus a second contextual panel whose content follows the active area.
  Double-chrome pattern.
-->
<template>
  <DesktopShell :scroll="isOverview">
    <template #rail>
      <Rail class="gap-1">
        <RailItem :label="WORKSPACE.name" variant="tile" :active="false">
          <FrappeMark class="h-3.5 text-ink-gray-8" />
        </RailItem>

        <div class="my-1 h-px w-6 shrink-0 bg-surface-gray-4" />

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

        <div class="flex-1" />

        <RailItem label="Notifications" icon="lucide-bell" variant="ghost" />
        <RailItem label="Settings" icon="lucide-settings" variant="ghost" />
        <RailItem :label="USER.name" variant="ghost">
          <Avatar size="sm" :label="USER.name" />
        </RailItem>
      </Rail>
    </template>

    <template #sidebar>
      <Sidebar width="14rem" disable-collapse>
        <div class="flex h-full flex-col border-l border-outline-gray-2 p-2">
          <template v-if="isOverview">
            <WorkspaceSwitcher />
            <h3 class="px-2 pb-1.5 pt-2 text-sm text-ink-gray-5">Folders</h3>
            <nav class="flex flex-col gap-0.5">
              <SidebarItem
                v-for="folder in FOLDERS"
                :key="folder.id"
                :label="folder.label"
                :icon="folder.icon"
              />
            </nav>
          </template>

          <template v-else-if="area === 'mail'">
            <div class="flex h-12 shrink-0 items-center px-1.5">
              <span class="text-base font-medium text-ink-gray-8">Mail</span>
            </div>
            <MailboxList />
          </template>

          <template v-else>
            <div class="flex h-12 shrink-0 items-center px-1.5">
              <span class="text-base font-medium text-ink-gray-8">Calendar</span>
            </div>
            <MiniMonth />
            <h3 class="px-2 pb-1.5 pt-2 text-sm text-ink-gray-5">My calendars</h3>
            <div
              v-for="cal in CALENDARS"
              :key="cal.id"
              class="flex items-center gap-2 px-2 py-1.5"
            >
              <span class="size-2.5 rounded-full" :class="cal.dot" />
              <span class="text-base text-ink-gray-8">{{ cal.label }}</span>
            </div>
          </template>
        </div>
      </Sidebar>
    </template>

    <component :is="areaComponent" />
  </DesktopShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Avatar, DesktopShell, Rail, RailItem, Sidebar, SidebarItem } from 'frappe-ui'

import CalendarArea from './areas/CalendarArea.vue'
import FilesArea from './areas/FilesArea.vue'
import HomeArea from './areas/HomeArea.vue'
import MailArea from './areas/MailArea.vue'
import { CALENDARS, FOLDERS, NAV_ITEMS, USER, WORKSPACE } from './fixtures'
import FrappeMark from './parts/FrappeMark.vue'
import MailboxList from './parts/MailboxList.vue'
import MiniMonth from './parts/MiniMonth.vue'
import WorkspaceSwitcher from './parts/WorkspaceSwitcher.vue'
import { useShellNav } from './useShellNav'

const { area, areaTo } = useShellNav()

const isOverview = computed(() => area.value === 'home' || area.value === 'files')

const AREA_COMPONENTS = {
  home: HomeArea,
  files: FilesArea,
  mail: MailArea,
  calendar: CalendarArea,
}
const areaComponent = computed(() => AREA_COMPONENTS[area.value])
</script>
