<template>
  <div v-if="store.accountId" class="flex h-full min-h-0 flex-col text-base">
    <AppSidebar />
    <router-view />
  </div>
</template>

<script setup lang="ts">
import AppSidebar from '@/apps/people/components/AppSidebar.vue'
import { userStore } from '@/apps/people/stores/user'

/**
 * People route-group layout. The suite shell provides the chrome and the one
 * FrappeUIProvider, so this only draws People's sidebar beside its pages.
 */
const store = userStore()
</script>
