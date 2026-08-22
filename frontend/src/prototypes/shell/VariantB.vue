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
  <DesktopShell :scroll="scrollContent" class="prototype-shell h-full">
    <template #rail>
      <Rail class="border-r">
        <!-- Cancel Rail's own top padding and stand exactly one PageHeader tall
             (min-h-12), so the divider below the logo continues the header's
             bottom border across the rail. -->
        <!-- The workspace's own mark, not the suite's: the rail is the only
             place it appears now, so it has to follow the switcher. -->
        <div class="-mt-2.5 flex h-12 shrink-0 items-center justify-center">
          <Avatar
            v-if="isPersonalWorkspace"
            :image="USER.avatar"
            :label="USER.name"
            class="size-7"
          />
          <FrappeTile v-else class="size-7" :title="currentWorkspace.name" />
        </div>

        <div class="flex w-full shrink-0 flex-col items-center gap-0.5 border-t pt-3">
          <SearchTrigger />
          <!-- The unread pill sits in the same corner as the shortcut hint, so
               the count stands down while Cmd is held. -->
          <RailItem
            v-for="item in NAV_ITEMS"
            :key="item.id"
            :label="item.label"
            variant="ghost"
            :to="areaTo(item.id)"
            :active="activeNavId === item.id"
            :badge="item.id === 'mail' && !modifierHeld ? inboxUnread : undefined"
          >
            <span :class="[item.icon, 'size-4']" aria-hidden="true" />
            <ShortcutHint :label="shortcutFor(item.id)" />
          </RailItem>
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

    <!-- An open document gets the whole pane. The rail is enough to leave the
         editor, and a sidebar beside it would only be a list of somewhere else. -->
    <template v-if="area !== 'doc'" #sidebar>
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
            <!-- The Screener stands above the labelled sections: it is a
                 decision queue, not a place mail is filed. -->
            <ScreenerLink />
            <div class="mt-2 flex h-7 items-center justify-between">
              <SidebarLabel>Mailboxes</SidebarLabel>
            </div>
            <MailboxList class="mt-0.5" />
            <div class="mt-3 flex h-7 items-center justify-between">
              <SidebarLabel>Folders</SidebarLabel>
              <Button variant="ghost" icon="lucide-plus" aria-label="New folder" />
            </div>
            <MailboxList :items="MAIL_FOLDERS" class="mt-0.5" />
          </template>

          <template v-else>
            <MiniMonth />
            <div class="flex h-7 items-center justify-between">
              <SidebarLabel>My calendars</SidebarLabel>
            </div>
            <nav class="mt-0.5 space-y-0.5">
              <SidebarItem v-for="cal in CALENDARS" :key="cal.id" :label="cal.label">
                <!-- The badge sits in the same 16px box an icon would, so
                     the labels line up with every other row in the panel. -->
                <template #prefix>
                  <span class="grid size-4 place-items-center">
                    <span class="size-2.5 rounded-1" :class="cal.dot" />
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
  Button,
  DesktopShell,
  Rail,
  RailItem,
  ScrollArea,
  Sidebar,
  SidebarItem,
  SidebarLabel,
  useTheme,
} from 'frappe-ui'

import CalendarArea from './areas/CalendarArea.vue'
import DocArea from './areas/DocArea.vue'
import FilesArea from './areas/FilesArea.vue'
import HomeArea from './areas/HomeArea.vue'
import MailArea from './areas/MailArea.vue'
import { CALENDARS } from './calendarFixtures'
import { FOLDERS, NAV_ITEMS, USER } from './fixtures'
import { MAIL_FOLDERS, unreadIn } from './mailFixtures'
import MailboxList from './parts/MailboxList.vue'
import ScreenerLink from './parts/ScreenerLink.vue'
import FrappeTile from './parts/FrappeTile.vue'
import MiniMonth from './parts/MiniMonth.vue'
import SearchTrigger from './parts/SearchTrigger.vue'
import ShortcutHint from './parts/ShortcutHint.vue'
import WorkspaceSwitcher from './parts/WorkspaceSwitcher.vue'
import { useShellNav } from './useShellNav'
import { modifierHeld, shortcutFor, useShellShortcuts } from './useShellShortcuts'
import { currentWorkspace, isPersonalWorkspace } from './workspaceState'

const { area, folder, areaTo, go } = useShellNav()

useShellShortcuts(go)
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

// The doc area is the exception: its editor owns its own scrolling.
const scrollContent = computed(() => isOverview.value)

// The rail has no doc item, so an open document keeps Files lit.
const activeNavId = computed(() => (area.value === 'doc' ? 'files' : area.value))

// Derived from the same fixture rows the Mail list renders, so the badge and
// the mailbox counts can never disagree.
const inboxUnread = computed(() => unreadIn('inbox'))

const AREA_COMPONENTS = {
  home: HomeArea,
  files: FilesArea,
  mail: MailArea,
  calendar: CalendarArea,
  doc: DocArea,
}
const areaComponent = computed(() => AREA_COMPONENTS[area.value])
</script>

<style scoped>
.prototype-shell :deep([data-slot='desktop-shell-content']) {
  @apply border-l bg-surface-base;
}
</style>
