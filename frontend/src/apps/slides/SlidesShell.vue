<template>
  <FrappeUIProvider>
    <router-view v-slot="{ Component }">
      <keep-alive :max="5">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </FrappeUIProvider>
</template>

<script setup>
import { h, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { toast, FrappeUIProvider } from 'frappe-ui'
import { Wifi, WifiOff } from 'lucide-vue-next'
import { saveCurrentState } from '@/apps/slides/stores/saving'
import { inSlideShowMode } from '@/apps/slides/stores/slideshow'
import { setupTheme } from '@/utils/setupTheme'
import { postToServiceWorker } from '@/apps/slides/utils/serviceWorker'
import { loadBundledFonts } from '@/apps/slides/utils/bundledFonts'
import '@/apps/slides/styles/fonts.css'

const isOnline = ref(navigator?.onLine ?? true)

const handleOffline = () => {
  isOnline.value = false
  if (inSlideShowMode.value) return
  toast('Lost internet connection.', {
    icon: () => h(WifiOff, { class: 'size-4' }),
  })
}

const handleOnline = () => {
  isOnline.value = true
  saveCurrentState()
  if (inSlideShowMode.value) return
  toast('You are back online.', {
    icon: () => h(Wifi, { class: 'size-4' }),
  })
}

onBeforeRouteLeave(() => postToServiceWorker('slides-left'))

const registerServiceWorker = () => {
  // opt-in on the dev server: this worker claims the root scope
  const enabled = import.meta.env.PROD || import.meta.env.VITE_SLIDES_SW === '1'
  if (!('serviceWorker' in navigator) || !enabled) return
  if (window.disable_slides_service_worker) {
    navigator.serviceWorker
      .getRegistration('/')
      .then((registration) => registration?.unregister())
      .catch(() => {})
    return
  }
  navigator.serviceWorker.register('/service-worker.js').catch((err) => {
    console.warn('Slides Service Worker registration failed:', err)
  })
}

watch(inSlideShowMode, (presenting) => {
  document.body.classList.toggle('slides-presenting', presenting)
})

onMounted(() => {
  isOnline.value = navigator?.onLine
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  registerServiceWorker()
  loadBundledFonts()
  setupTheme()
  document.documentElement.style.overscrollBehavior = 'none'
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  document.body.classList.remove('slides-presenting')
  document.documentElement.style.overscrollBehavior = ''
})

provide('isOnline', isOnline)
</script>

<style>
body.slides-presenting [data-sonner-toaster] {
  display: none;
}

.no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.faded-scroll {
  --fade-length: 12px;
  --fade-mask: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0) 0,
    rgb(0 0 0 / 0.08) calc(var(--fade-length) * 0.25),
    rgb(0 0 0 / 0.29) calc(var(--fade-length) * 0.5),
    rgb(0 0 0 / 0.61) calc(var(--fade-length) * 0.7),
    rgb(0 0 0 / 0.89) calc(var(--fade-length) * 0.88),
    rgb(0 0 0 / 1) var(--fade-length),
    rgb(0 0 0 / 1) calc(100% - var(--fade-length)),
    rgb(0 0 0 / 0.89) calc(100% - var(--fade-length) * 0.88),
    rgb(0 0 0 / 0.61) calc(100% - var(--fade-length) * 0.7),
    rgb(0 0 0 / 0.29) calc(100% - var(--fade-length) * 0.5),
    rgb(0 0 0 / 0.08) calc(100% - var(--fade-length) * 0.25),
    rgb(0 0 0 / 0) 100%
  );
  -webkit-mask-image: var(--fade-mask);
  mask-image: var(--fade-mask);
  scrollbar-width: none;
}
.faded-scroll::-webkit-scrollbar {
  display: none;
}
</style>
