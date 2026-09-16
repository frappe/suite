<template>
  <FrappeUIProvider>
    <template v-if="isLoggedIn || $route.meta.allowGuest">
      <div v-if="$route.name === 'drive-Signup'" id="dropzone" class="h-full">
        <router-view :key="$route.fullPath" v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </div>
      <!-- Keep sticky page chrome below dialogs portalled to body. -->
      <DesktopShell v-else-if="isDesktop" :scroll="shellScroll" class="isolate">
        <template v-if="normalView" #sidebar>
          <Sidebar />
        </template>
        <div id="dropzone" class="relative flex min-h-full flex-col bg-surface-base" :class="{ 'h-full': !shellScroll }">
          <router-view :key="$route.fullPath" v-slot="{ Component }">
            <component :is="Component" />
          </router-view>
        </div>
      </DesktopShell>
      <MobileShell v-else class="isolate">
        <div id="dropzone" class="relative flex min-h-full flex-col bg-surface-base" :class="{ 'h-full': !shellScroll }">
          <router-view :key="$route.fullPath" v-slot="{ Component }">
            <component :is="Component" />
          </router-view>
        </div>
        <template v-if="!inIframe && isLoggedIn" #nav>
          <BottomBar />
        </template>
      </MobileShell>
    </template>
    <router-view v-else :key="$route.fullPath" v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
    <SearchPopup v-if="isLoggedIn && showSearchPopup" v-model="showSearchPopup" />
    <KeyboardShortcutsDialog v-model:open="showShortcuts" />
    <FileUploader
      v-if="normalView && ['drive-Folder', 'drive-Home'].includes($route.name) && !($route.name === 'drive-Home' && shareView)" />
    <FDialogs />
  </FrappeUIProvider>
</template>
<script setup>
import Sidebar from '@/apps/drive/components/Sidebar.vue'
import SearchPopup from '@/apps/drive/components/SearchPopup.vue'
import FDialogs from '@/apps/drive/components/FDialogs.vue'
import BottomBar from '@/apps/drive/components/BottomBar.vue'
import FileUploader from '@/apps/drive/components/FileUploader.vue'
import { useSessionStore } from '@/boot/session'
import { ref, computed, onMounted, provide } from 'vue'
import { sidebarCollapsed, shareView } from '@/apps/drive/data/prefs'
import { useMediaQuery } from '@vueuse/core'
import emitter from '@/apps/drive/emitter'
import { useEmitter } from '@/apps/drive/utils/useEmitter'
import { initSocket } from '@/apps/drive/socket'
import { DesktopShell, FrappeUIProvider, KeyboardShortcutsDialog, MobileShell, useKeyboardShortcut } from 'frappe-ui'
import { useRoute, useRouter } from 'vue-router'
import { setupTheme } from '@/utils/setupTheme'
import { rootInfo } from '@/apps/drive/resources/files'
import { isApple } from '@/apps/drive/utils/files'

// Provided from the route-group layout since the suite main.ts is shared.
provide('emitter', emitter)
provide('socket', initSocket())

const route = useRoute()
const router = useRouter()
const isDesktop = useMediaQuery('(min-width: 768px)')
const shellScroll = computed(() => route.meta.shellScroll !== false)
const inIframe = window.self !== window.top
provide('inIframe', inIframe)

const showSearchPopup = ref(false)
const showShortcuts = ref(false)
const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
const normalView = computed(() => !inIframe && isLoggedIn.value)
useEmitter('showSearchPopup', (data) => {
  showSearchPopup.value = data
})

onMounted(() => {
  setupTheme()
})

const accessKey = (key) => {
  if (isApple()) return `Ctrl+Alt+${key}`
  if (navigator.userAgent.includes('Firefox')) return `Alt+Shift+${key}`
  return `Alt+${key}`
}

const shortcut = (combo, description, group, handler) => ({
  combo,
  description: __(description),
  group: __(group),
  enabled: normalView,
  handler,
})

useKeyboardShortcut([
  shortcut('Mod+K', 'Find Files', 'General', () => (showSearchPopup.value = true)),
  shortcut('Mod+Shift+Comma', 'Open Settings', 'General', () => emitter.emit('showSettings')),
  shortcut('Mod+Shift+ArrowRight', 'Expand sidebar', 'General', () => (sidebarCollapsed.value = false)),
  shortcut('Mod+Shift+ArrowLeft', 'Collapse sidebar', 'General', () => (sidebarCollapsed.value = true)),
  {
    combo: 'Shift+Slash',
    description: __('View Shortcuts'),
    group: __('General'),
    enabled: normalView,
    allowInDialog: true,
    handler: () => (showShortcuts.value = !showShortcuts.value),
  },
  shortcut(accessKey('I'), 'Inbox', 'Navigation', () => router.push({ name: 'drive-Inbox' })),
  shortcut(accessKey('H'), 'Home', 'Navigation', () => router.push({ name: 'drive-Home' })),
  shortcut(accessKey('E'), 'Everyone', 'Navigation', () => {
    if (rootInfo.data?.root) router.push({ name: 'drive-Folder', params: { entityName: rootInfo.data.root } })
  }),
  shortcut(accessKey('R'), 'Recents', 'Navigation', () => router.push({ name: 'drive-Recents' })),
  shortcut(accessKey('F'), 'Favourites', 'Navigation', () => router.push({ name: 'drive-Favourites' })),
  shortcut(accessKey('A'), 'Attachments', 'Navigation', () => router.push({ name: 'drive-Attachments' })),
  shortcut(accessKey('D'), 'Documents', 'Navigation', () => router.push({ name: 'drive-Documents' })),
  shortcut('Mod+A', 'Select all', 'List', () => emitter.emit('selectAll')),
  shortcut('Escape', 'Unselect all', 'List', () => emitter.emit('clearSelection')),
  shortcut(accessKey('S'), 'Share selected file', 'List', () => emitter.emit('share')),
  shortcut('Ctrl+M', 'Move selected files', 'List', () => emitter.emit('move')),
  shortcut('Mod+Backspace', 'Delete selected files', 'List', () => emitter.emit('remove')),
  shortcut('Mod+Enter', 'Open selected file in new tab', 'List', () => emitter.emit('openInNewTab')),
  shortcut(accessKey('U'), 'Upload a file', 'List', () => emitter.emit('uploadFile')),
  shortcut(accessKey('N'), 'Create a folder', 'List', () => emitter.emit('newFolder')),
])

</script>
