<template>
  <Sidebar id="sidebar" v-model:collapsed="sidebarCollapsed" class="hidden sm:flex" :header="{
    title: 'Drive',
    subtitle: currentUserFullName,
    menuItems: settingsItems,
    logo: FrappeDriveLogo,
  }" :sections="sidebarItems">
    <template #footer-items="{ isCollapsed }">
      <StorageBar v-if="teamExists.data" :is-expanded="!isCollapsed" />
    </template>
    <template #sidebar-item="{ item, isCollapsed }">
      <SidebarItem :class="draggedSpace === item.label &&
        'ring-1 ring-outline-gray-3 !bg-surface-gray-3'
        " :label="item.label" :accessKey="item.accessKey" :icon="item.icon" :suffix="item.suffix" :to="item.to"
        :isActive="item.isActive" :isCollapsed :onClick="item.onClick" @dragover.prevent="
          ; (['Trash', 'Home'].includes(item.label) ||
          item.to?.name === 'drive-Team') &&
          (draggedSpace = item.label)
          " @dragleave="draggedSpace = null" @drop.prevent="handleDrop($event, item)" />
    </template>
  </Sidebar>
  <SettingsDialog v-if="showSettings" v-model="showSettings" :suggested-tab="suggestedTab" />
  <ShortcutsDialog v-if="showShortcuts" v-model="showShortcuts" />
</template>
<script setup>
import FrappeDriveLogo from '@/apps/drive/components/FrappeDriveLogo.vue'

import StorageBar from './StorageBar.vue'
import { Sidebar, SidebarItem, createResource } from 'frappe-ui'
import { notifCount, apps } from '@/apps/drive/resources/permissions'
import { getTeams } from '@/apps/drive/resources/files'
import { dynamicList } from '@/apps/drive/utils/files'

import { useCurrentUser, useSessionStore } from '@/boot/session'
const { fullName: currentUserFullName } = useCurrentUser()
import { getRootSection } from '@/apps/drive/data/breadcrumbs'
import { sidebarCollapsed } from '@/apps/drive/data/prefs'
import icons from '@/apps/drive/utils/icons'
import LucideClock from '~icons/lucide/clock'
import LucideUsers from '~icons/lucide/users'
import LucideFiles from '~icons/lucide/files'
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
import { ref, computed, watch, h } from 'vue'
import AppsIcon from '@/apps/drive/components/AppsIcon.vue'
import { useRouter, useRoute } from 'vue-router'
import { move } from '@/apps/drive/resources/files'

import LucideBook from '~icons/lucide/book'
import LucideBadgeHelp from '~icons/lucide/badge-help'
import LucideSunMoon from '~icons/lucide/sun-moon'
import LucideSun from '~icons/lucide/sun'
import LucideMoon from '~icons/lucide/moon'
import LucideMonitor from '~icons/lucide/monitor'
import LucideCheck from '~icons/lucide/check'
import { getThemeMode, switchTheme } from '@/apps/drive/utils/setupTheme'

defineEmits(['toggleMobileSidebar', 'showSearchPopUp'])
const router = useRouter()
const route = useRoute()
notifCount.fetch()
getTeams.fetch()
apps.fetch()

const teamExists = createResource({
  url: 'suite.drive.utils.get_default_team',
  auto: true,
  onSuccess: (d) => !d && router.replace({ name: 'drive-Setup' }),
})

const showSettings = ref(false)
const showShortcuts = ref(false)
const suggestedTab = ref(0)
emitter.on('showSettings', (val = 0) => {
  if (val === -1) showSettings.value = false
  else {
    showSettings.value = true
    suggestedTab.value = val
  }
})
emitter.on('toggleShortcuts', () => {
  showShortcuts.value = !showShortcuts.value
})

const themeMode = ref(getThemeMode())

function selectTheme(theme) {
  switchTheme(theme)
  themeMode.value = theme.toLowerCase()
}

const settingsItems = computed(() => [
  {
    group: __('Manage'),
    hideLabel: true,
    items: [
      {
        icon: AppsIcon,
        label: __('Apps'),
        submenu: apps.data?.map?.((app) => ({
          label: app.title,
          icon: app.logo,
          component: h(
            'a',
            {
              class:
                'flex items-center gap-2 p-1.5 rounded hover:bg-surface-gray-2',
              href: app.route,
            },
            [
              h('img', { src: app.logo, class: 'size-6' }),
              h(
                'span',
                { class: 'max-w-18 text-sm w-full truncate text-ink-gray-9' },
                app.title
              ),
            ]
          ),
        })),
      },
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
            onClick: () => selectTheme('Light'),
          },
          {
            label: __('Dark'),
            icon: themeMode.value === 'dark' ? LucideCheck : LucideMoon,
            onClick: () => selectTheme('Dark'),
          },
          {
            label: __('Automatic'),
            icon: themeMode.value === 'automatic' ? LucideCheck : LucideMonitor,
            onClick: () => selectTheme('Automatic'),
          },
        ],
      },
    ],
  },
  {
    group: __('Others'),
    hideLabel: true,
    items: [
      {
        icon: 'settings',
        label: __('Settings'),
        onClick: () => (showSettings.value = true),
      },
      {
        icon: 'log-out',
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
        },
        {
          label: __('Inbox'),
          icon: LucideInbox,
          to: { name: 'drive-Inbox' },
          isActive: active('drive-Inbox'),
          accessKey: 'i',
          suffix: notifCount.data,
        },
      ],
    },
    {
      label: 'Drive',
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
          label: 'Shared',
          to: { name: 'drive-Shared' },
          icon: LucideUsers,
          isActive: active('drive-Shared'),
          accessKey: 's',
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
      label: 'Teams',
      cond: getTeams.data && Object.keys(getTeams.data).length > 0,
      collapsible: true,
      items:
        getTeams.data &&
        Object.values(getTeams.data).map((team) => ({
          label: team.title,
          to: { name: 'drive-Team', params: { team: team.name } },
          icon: h(icons[team.icon || 'building']),
          isActive:
            (route.name === 'drive-Team' && route.params.team === team.name) ||
            first.name === team.name,
          accessKey: 't',
        })),
    },
    {
      label: 'Views',
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
          label: 'Favourites',
          to: { name: 'drive-Favourites' },
          icon: LucideStar,
          isActive: active('drive-Favourites'),
          accessKey: 'f',
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
  const file_name = e.dataTransfer.getData('application/x-filename')
  if (space.label === 'Trash') {
    emitter.emit('remove-file', file_name)
  } else if (space.label === 'Home') {
    move.submit(
      { entity_names: [file_name] },
      { onSuccess: () => emitter.emit('remove-file-ui', file_name) }
    )
  } else if (space.to?.name === 'drive-Team') {
    const team = space.to.params.team
    move.submit(
      { entity_names: [file_name], team },
      { onSuccess: () => emitter.emit('remove-file-ui', file_name) }
    )
  }
}
</script>
