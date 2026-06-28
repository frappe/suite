<template>
  <FrappeUIProvider>
    <div v-if="isLoggedIn || $route.meta.isPublic" class="flex flex-col sm:flex-row h-full">
      <Sidebar v-if="normalView" />
      <div id="dropzone" class="flex flex-col flex-1 overflow-hidden bg-surface-base relative">
        <router-view :key="$route.fullPath" v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </div>
      <BottomBar v-if="!inIframe && isLoggedIn" class="w-full sm:hidden" />
    </div>
    <router-view v-else :key="$route.fullPath" v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
    <SearchPopup v-if="isLoggedIn && showSearchPopup" v-model="showSearchPopup" />
    <button accesskey="u" class="hidden" @click="emitter.emit('uploadFile')" />
    <FileUploader v-if="normalView && ['drive-Folder', 'drive-Home', 'drive-Team'].includes($route.name)" />
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
import { sidebarCollapsed } from '@/apps/drive/data/prefs'
import { onKeyDown } from '@vueuse/core'
import emitter from '@/apps/drive/emitter'
import { initSocket } from '@/apps/drive/socket'
import { FrappeUIProvider } from 'frappe-ui'
import { useRoute } from 'vue-router'
import { setupTheme } from '@/apps/drive/utils/setupTheme'
import '@/apps/drive/index.css'

// The standalone main.ts provided these via `app.provide`. Provide them from the
// route-group layout instead.
provide('emitter', emitter)
provide('socket', initSocket())

const route = useRoute()
const inIframe = window.self !== window.top
provide('inIframe', inIframe)

const showSearchPopup = ref(false)
const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
const normalView = computed(
  () =>
    !inIframe &&
    isLoggedIn.value &&
    !['drive-Teams', 'drive-Setup'].includes(route.name)
)
emitter.on('showSearchPopup', (data) => {
  showSearchPopup.value = data
})

onMounted(() => {
  // was `setupTheme().then(app.mount)` in the standalone main.ts
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
    if (e.key == ',') {
      emitter.emit('showSettings')
      e.preventDefault()
    }
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
