<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
    <h1 class="text-2xl-semibold text-ink-gray-9">Could not load {{ appName }}</h1>
    <p class="text-sm text-ink-gray-6">Check your connection and try again.</p>
    <div class="flex items-center gap-3">
      <button class="text-sm text-ink-blue-link hover:underline" @click="retry">Try again</button>
      <router-link to="/suite" class="text-sm text-ink-gray-6 hover:underline">
        Back to launcher
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const appName = computed(() => String(route.query.app || 'app'))

const retry = () => router.replace(String(route.query.redirect || '/suite'))
</script>
