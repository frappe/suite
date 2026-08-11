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
    <button accesskey="u" class="hidden" @click="emitter.emit('uploadFile')" />
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
import { onKeyDown, useMediaQuery } from '@vueuse/core'
import emitter from '@/apps/drive/emitter'
import { initSocket } from '@/apps/drive/socket'
import { DesktopShell, FrappeUIProvider, MobileShell } from 'frappe-ui'
import { useRoute } from 'vue-router'
import { setupTheme } from '@/utils/setupTheme'

// Provided from the route-group layout since the suite main.ts is shared.
provide('emitter', emitter)
provide('socket', initSocket())

const route = useRoute()
const isDesktop = useMediaQuery('(min-width: 768px)')
const shellScroll = computed(() => route.meta.shellScroll !== false)
const inIframe = window.self !== window.top
provide('inIframe', inIframe)

const showSearchPopup = ref(false)
const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
const normalView = computed(() => !inIframe && isLoggedIn.value)
emitter.on('showSearchPopup', (data) => {
  showSearchPopup.value = data
})

onMounted(() => {
  setupTheme()
})

const EMITTERS = {
  u: () => emitter.emit('uploadFile'),
  n: () => emitter.emit('newFolder'),
  m: () => emitter.emit('move'),
  p: () => emitter.emit('share'),
  e: () => emitter.emit('rename'),
}
for (const k in EMITTERS) {
  const btn = document.createElement('button')
  btn.style.display = 'none'
  btn.accessKey = k
  btn.onclick = EMITTERS[k]
  document.body.appendChild(btn)
}

onKeyDown((e) => {
  if (
    e.target.classList.contains('ProseMirror') ||
    e.target.tagName === 'INPUT' ||
    e.target.tagName === 'TEXTAREA'
  )
    return
  if (e.key == '?') emitter.emit('toggleShortcuts')

  if (e.metaKey) {
    if (e.shiftKey) {
      if (e.key == 'ArrowRight') {
        sidebarCollapsed.value = false
      } else if (e.key == 'ArrowLeft') {
        sidebarCollapsed.value = true
        e.preventDefault()
      }
    }
    if (e.key == 'k') {
      showSearchPopup.value = true
      e.preventDefault()
    }
  }
})
</script>
