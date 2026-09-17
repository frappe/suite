<template>
  <!-- '/suite' launcher: brand-logo app switcher for all 7 suite apps. -->
  <div class="flex h-full flex-col">
    <header class="flex h-12 shrink-0 items-center justify-between border-b p-2">
      <div v-if="workspaceName" class="flex items-center gap-2">
        <Avatar :image="workspaceLogo" :label="workspaceName" shape="square" size="lg" />
        <div class="text-md-medium">{{ workspaceName }}</div>
      </div>
      <div v-else />

      <Dropdown :options="userMenuOptions" align="end">
        <button
          class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
          :aria-label="__('User menu')"
        >
          <Avatar :image="imageURL" :label="fullName" size="lg" />
        </button>
      </Dropdown>
    </header>

    <div class="flex-1 overflow-auto">
      <div class="mx-auto flex min-h-full max-w-5xl flex-col px-6 pt-[8%] pb-16">
        <div class="mx-auto grid grid-cols-3 gap-x-10 gap-y-10 min-[480px]:grid-cols-4 min-[480px]:gap-x-20">
          <LauncherTile
            v-for="app in apps"
            :key="app.id"
            :to="app.prefix"
            :logo="app.logo"
            :label="app.name"
          />

          <LauncherTile :logo="settingsLogo" :label="__('Settings')" @click="openSettings()" />
        </div>
      </div>
    </div>

    <SuiteSettingsDialog v-model:open="showSettings" v-model:tab="settingsTab" />
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, onUnmounted } from 'vue'
import { Avatar, Dropdown, toast } from 'frappe-ui'
import { CircleUser, LogOut } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { SUITE_APPS } from '@/apps/registry'
import { useStartMeeting } from '@/apps/meet/composables/useStartMeeting'
import settingsLogo from '@/assets/app-logos/settings.svg'
import { useCurrentUser, useSessionStore } from '@/boot/session'
import { useThemeMenuOption } from '@/composables/useThemeMenuOption'
import LauncherTile from '@/shell/LauncherTile.vue'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'
import { openSettings, settingsTab, showSettings } from '@/shell/settings/useSettingsDialog'
import { useWorkspace } from '@/shell/useWorkspace'
import { useRootStore } from '@/stores/root'
import { setupTheme } from '@/utils/setupTheme'

const apps = SUITE_APPS
const router = useRouter()
const root = useRootStore()
const { fullName, imageURL } = useCurrentUser()
const { startMeeting } = useStartMeeting()

const composeMail = () => router.push({ path: '/mail', query: { compose: '1' } })

const startInstantMeeting = () => startMeeting('open')

const createCalendarEvent = async () => {
  const { userStore } = await import('@/apps/calendar/stores/user')
  const calendarStore = userStore()
  try {
    if (!calendarStore.userResource.data) await calendarStore.userResource.fetch()
    if (!calendarStore.accountId) {
      toast.error('Set up Calendar before creating an event.')
      return
    }
    await router.push({ path: '/calendar', query: { new: '1' } })
  } catch {
    toast.error('Could not load Calendar account.')
  }
}

const unregisterPaletteGroups = root.registerPaletteGroups('suite-launcher', () => [
  {
    commands: [
      {
        id: 'suite-compose-mail',
        label: 'Compose mail',
        enterHint: 'compose mail',
        icon: 'lucide-pencil',
        keywords: ['new', 'email', 'message'],
        run: composeMail,
      },
      {
        id: 'suite-start-instant-meet',
        label: 'Start instant meet',
        enterHint: 'start instant meet',
        icon: 'lucide-zap',
        keywords: ['new', 'open', 'meeting'],
        run: startInstantMeeting,
      },
      {
        id: 'suite-new-event',
        label: 'New event',
        enterHint: 'create event',
        icon: 'lucide-calendar-plus',
        keywords: ['create', 'calendar'],
        run: createCalendarEvent,
      },
      {
        id: 'suite-new-sheet',
        label: 'New sheet',
        enterHint: 'create sheet',
        icon: 'lucide-table-2',
        keywords: ['create', 'spreadsheet', 'sheets'],
        run: () => router.push('/sheets/new'),
      },
      {
        id: 'suite-new-presentation',
        label: 'New presentation',
        enterHint: 'create presentation',
        icon: 'lucide-presentation',
        keywords: ['create', 'slides'],
        run: () => router.push('/slides/presentation/new'),
      },
      {
        id: 'suite-settings',
        label: 'Settings',
        shortcut: 'Mod+Shift+Comma',
        enterHint: 'open settings',
        icon: 'lucide-settings',
        keywords: ['account', 'personal', 'preferences', 'workspace'],
        run: () => openSettings(),
      },
    ],
  },
])

const { workspaceName, workspaceLogo } = useWorkspace()

const sessionStore = useSessionStore()

const userMenuOptions = [
  {
    label: __('My Profile'),
    icon: h(CircleUser, { class: 'stroke-[1.5]' }),
    onClick: () => openSettings('profile'),
  },
  useThemeMenuOption(),
  {
    label: __('Log out'),
    icon: h(LogOut, { class: 'stroke-[1.5]' }),
    onClick: () => sessionStore.logout.submit(),
  },
]

onMounted(() => {
  setupTheme()
  document.documentElement.style.overscrollBehavior = 'none'
})

onUnmounted(() => {
  document.documentElement.style.overscrollBehavior = ''
  unregisterPaletteGroups()
})
</script>
