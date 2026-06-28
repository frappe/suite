<template>
  <router-view v-slot="{ Component }">
    <keep-alive :max="5">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>

<script setup>
import { h, onMounted, onUnmounted, provide, ref } from 'vue'
import { toast } from 'frappe-ui'
import { Wifi, WifiOff } from 'lucide-vue-next'
import { saveCurrentState } from '@/apps/slides/stores/saving'

const isOnline = ref(navigator?.onLine ?? true)

const handleOffline = () => {
  isOnline.value = false
  toast.create({
    message: 'Lost internet connection.',
    icon: h(WifiOff, { color: 'white' }),
  })
}

const handleOnline = () => {
  isOnline.value = true
  saveCurrentState()
  toast.create({
    message: 'You are back online.',
    icon: h(Wifi, { color: 'white' }),
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
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})

provide('isOnline', isOnline)
</script>
