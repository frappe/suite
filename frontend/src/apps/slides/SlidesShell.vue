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
import { h, onMounted, onUnmounted, provide, ref } from 'vue'
import { toast, FrappeUIProvider } from 'frappe-ui'
import { Wifi, WifiOff } from 'lucide-vue-next'
import { saveCurrentState } from '@/apps/slides/stores/saving'
import { setupTheme } from '@/utils/setupTheme'
import '@/apps/slides/styles/fonts.css'

const isOnline = ref(navigator?.onLine ?? true)

// Inter is in the app bundle, these aren't. Load every face so the picker never swaps.
const bundledFontFaces = [
  '400 16px Anton',
  '400 16px "Courier Prime"',
  'italic 400 16px "Courier Prime"',
  '700 16px "Courier Prime"',
  'italic 700 16px "Courier Prime"',
]

// One char per unicode-range subset; load() samples basic Latin otherwise.
const subsetSample = 'AĀẠ'

const preloadBundledFonts = () => {
  if (!document.fonts?.load) return
  bundledFontFaces.forEach((face) => document.fonts.load(face, subsetSample))
}

const handleOffline = () => {
  isOnline.value = false
  toast('Lost internet connection.', {
    icon: () => h(WifiOff, { class: 'size-4' }),
  })
}

const handleOnline = () => {
  isOnline.value = true
  saveCurrentState()
  toast('You are back online.', {
    icon: () => h(Wifi, { class: 'size-4' }),
  })
}

const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  navigator.serviceWorker.register('/service-worker.js').catch((err) => {
    console.warn('Slides Service Worker registration failed:', err)
  })
}

onMounted(() => {
  isOnline.value = navigator?.onLine
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  registerServiceWorker()
  preloadBundledFonts()
  setupTheme()
  document.documentElement.style.overscrollBehavior = 'none'
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  document.documentElement.style.overscrollBehavior = ''
})

provide('isOnline', isOnline)
</script>

<style>
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
