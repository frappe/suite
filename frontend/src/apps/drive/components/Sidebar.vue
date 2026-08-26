<template>
  <Sidebar id="sidebar" v-model:collapsed="sidebarCollapsed" class="hidden md:flex">
    <SidebarHeader title="Drive" :subtitle="currentUserFullName" :menu-items="settingsItems" :logo="FrappeDriveLogo" />
    <div class="flex-1 overflow-y-auto px-2">
      <SidebarSection v-for="(section, index) in sidebarItems" :key="section.label || index" :label="section.label" :collapsible="section.collapsible">
        <SidebarItem v-for="item in section.items" :key="item.label" :class="draggedSpace === item.label && 'ring-1 ring-outline-gray-3 !bg-surface-gray-3'" :label="item.label" :access-key="item.accessKey" :icon="item.icon" :suffix="item.suffix" :to="item.to" :active="item.isActive" :on-click="item.onClick" @dragover.prevent=";['Trash', 'Home'].includes(item.label) && (draggedSpace = item.label)" @dragleave="draggedSpace = null" @drop.prevent="handleDrop($event, item)" />
      </SidebarSection>
    </div>
    <div class="p-2">
      <StorageBar :is-expanded="!sidebarCollapsed" />
      <SidebarCollapseToggle />
    </div>
  </Sidebar>
  <SettingsDialog v-model="showSettings" :suggested-tab="suggestedTab" />
  <ShortcutsDialog v-if="showShortcuts" v-model="showShortcuts" />
</template>
<script setup>
import FrappeDriveLogo from '@/apps/drive/components/FrappeDriveLogo.vue'

import StorageBar from './StorageBar.vue'
import { Sidebar, SidebarCollapseToggle, SidebarHeader, SidebarItem, SidebarSection } from 'frappe-ui'
import { notifCount, apps } from '@/apps/drive/resources/permissions'
import { rootInfo } from '@/apps/drive/resources/files'
import { dynamicList, isApple } from '@/apps/drive/utils/files'

import { useCurrentUser, useSessionStore } from '@/boot/session'
const { fullName: currentUserFullName } = useCurrentUser()
import { getRootSection } from '@/apps/drive/data/breadcrumbs'
import { sidebarCollapsed } from '@/apps/drive/data/prefs'
import LucideClock from '~icons/lucide/clock'
import LucideBuilding2 from '~icons/lucide/building-2'
import LucideTrash from '~icons/lucide/trash'
import LucideHome from '~icons/lucide/home'
import LucideStar from '~icons/lucide/star'
import LucidePaperclip from '~icons/lucide/paperclip'
import LucideInbox from '~icons/lucide/inbox'
import LucideSearch from '~icons/lucide/search'
import LucideFileText from '~icons/lucide/file-text'
import LucideGalleryVerticalEnd from '~icons/lucide/gallery-vertical-end'

import SettingsDialog from '@/apps/drive/components/Settings/SettingsDialog.vue'
import ShortcutsDialog from '@/apps/drive/components/ShortcutsDialog.vue'
import emitter from '@/apps/drive/emitter'
import { useEmitter } from '@/apps/drive/utils/useEmitter'
import { ref, computed, watch } from 'vue'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import { useRouter, useRoute } from 'vue-router'
import { move } from '@/apps/drive/resources/files'

import LucideBook from '~icons/lucide/book'
import LucideBadgeHelp from '~icons/lucide/badge-help'
import LucideSunMoon from '~icons/lucide/sun-moon'
import LucideSun from '~icons/lucide/sun'
import LucideMoon from '~icons/lucide/moon'
import LucideMonitor from '~icons/lucide/monitor'
import LucideCheck from '~icons/lucide/check'
import { themeMode, switchTheme } from '@/utils/setupTheme'

defineEmits(['toggleMobileSidebar', 'showSearchPopUp'])
const router = useRouter()
const route = useRoute()
notifCount.fetch()
rootInfo.fetch()

const showSettings = ref(false)
const showShortcuts = ref(false)
const suggestedTab = ref('profile')
useEmitter('showSettings', (val = 'profile') => {
  if (val === -1) showSettings.value = false
  else {
    showSettings.value = true
    suggestedTab.value = val
  }
})
useEmitter('toggleShortcuts', () => {
  showShortcuts.value = !showShortcuts.value
})

const appsMenuOption = useAppSwitcher('drive')

const settingsItems = computed(() => [
  {
    group: __('Manage'),
    hideLabel: true,
    options: [
      appsMenuOption.value,
      {
        icon: LucideBook,
        label: __('Documentation'),
        onClick: () => window.open('https://docs.frappe.io/drive', '_blank'),
      },
      {
        icon: LucideBadgeHelp,
        label: __('Support'),
        onClick: () => window.open('https://t.me/frappedrive', '_blank'),
      },
      {
        icon: LucideSunMoon,
        label: __('Theme'),
        submenu: [
          {
            label: __('Light'),
            icon: themeMode.value === 'light' ? LucideCheck : LucideSun,
            onClick: () => switchTheme('Light'),
          },
          {
            label: __('Dark'),
            icon: themeMode.value === 'dark' ? LucideCheck : LucideMoon,
            onClick: () => switchTheme('Dark'),
          },
          {
            label: __('Automatic'),
            icon: themeMode.value === 'automatic' ? LucideCheck : LucideMonitor,
            onClick: () => switchTheme('Automatic'),
          },
        ],
      },
    ],
  },
  {
    group: __('Others'),
    hideLabel: true,
    options: [
      {
        icon: 'lucide-settings',
        label: __('Settings'),
        onClick: () => (showSettings.value = true),
      },
      {
        icon: 'lucide-log-out',
        label: __('Log out'),
        onClick: logout,
      },
    ],
  },
])

function logout() {
  useSessionStore().logout.submit()
}

const sidebarItems = computed(() => {
  const first = getRootSection()
  const active = (routeName) =>
    route.name === routeName || first.name === routeName
  return dynamicList([
    {
      items: [
        {
          label: __('Search'),
          icon: LucideSearch,
          onClick: () => emitter.emit('showSearchPopup', true),
          suffix: isApple() ? '⌘ + K' : 'Ctrl + K',
        },
        {
          label: __('Notifications'),
          icon: LucideInbox,
          to: { name: 'drive-Inbox' },
          isActive: active('drive-Inbox'),
          accessKey: 'i',
          suffix: notifCount.data ? String(notifCount.data) : undefined,
        },
      ],
    },
    {
      items: [
        {
          label: 'Home',
          to: { name: 'drive-Home' },
          icon: LucideHome,
          isActive: active('drive-Home'),
          accessKey: 'h',
        },
        {
          label: 'Recents',
          to: { name: 'drive-Recents' },
          icon: LucideClock,
          isActive: active('drive-Recents'),
          accessKey: 'r',
        },
        {
          label: 'Favourites',
          to: { name: 'drive-Favourites' },
          icon: LucideStar,
          isActive: active('drive-Favourites'),
          accessKey: 'f',
        },
        {
          label: 'Everyone',
          to: rootInfo.data
            ? {
                name: 'drive-Folder',
                params: { entityName: rootInfo.data.root },
              }
            : undefined,
          icon: LucideBuilding2,
          isActive:
            route.params.entityName === rootInfo.data?.root ||
            first.name === rootInfo.data?.root,
          accessKey: 'e',
        },
        {
          label: 'Trash',
          to: { name: 'drive-Trash' },
          icon: LucideTrash,
          isActive: active('drive-Trash'),
        },
      ],
    },
    {
      label: 'Browse',
      collapsible: true,
      items: dynamicList([
        {
          label: 'Attachments',
          to: { name: 'drive-Attachments' },
          icon: LucidePaperclip,
          isActive: active('drive-Attachments'),
          accessKey: 'a',
        },
        {
          label: 'Documents',
          to: { name: 'drive-Documents' },
          icon: LucideFileText,
          isActive: active('drive-Documents'),
          accessKey: 'd',
        },
        {
          label: 'Presentations',
          to: { name: 'drive-Presentations' },
          icon: LucideGalleryVerticalEnd,
          isActive: active('drive-Presentations'),
          cond: apps.data?.find?.((k) => k.name === 'slides'),
        },
      ]),
    },
  ])
})

const draggedSpace = ref(null)
const handleDrop = (e, space) => {
  draggedSpace.value = null
  // Prefer the multi-selection payload, falling back to the single dragged file.
  let names = []
  try {
    names = JSON.parse(e.dataTransfer.getData('application/x-filenames') || '[]')
  } catch {
    names = []
  }
  if (!names.length) {
    const single = e.dataTransfer.getData('application/x-filename')
    if (single) names = [single]
  }
  if (!names.length) return
  const clearFromList = () =>
    names.forEach((name) => emitter.emit('remove-file-ui', name))
  if (space.label === 'Trash') {
    emitter.emit('remove-file', names)
  } else if (space.label === 'Home') {
    move.submit({ entity_names: names }, { onSuccess: clearFromList })
  }
}
</script>
