<template>
  <div
    class="flex flex-col items-center h-screen p-6 text-center mt-[10%] w-full"
  >
    <div class="size-16 rounded-full bg-surface-gray-2 flex items-center justify-center">
      <LucideFileUser v-if="forbidden" class="size-8 text-ink-gray-5" />
      <LucideFileQuestionMark v-else class="size-8 text-ink-gray-5" />
    </div>
    <h1 class="text-4xl-bold text-ink-gray-8 mt-4">Uh oh!</h1>
    <p class="text-lg text-ink-gray-5 mt-4">
      <template v-if="typeof error === 'string'">{{ error }}</template>
      <template v-else>
        {{ forbidden ? 'You do not have access to this.' : "This document doesn't exist." }}
      </template>
    </p>
    <div class="flex gap-8 my-12">
      <Button
        v-if="$router.options.history.state.back"
        variant="outline"
        size="md"
        @click="$router.go(-1)"
      >
        <div class="flex gap-2">
          <LucideArrowBigLeft class="size-4" />Go back
        </div>
      </Button>
      <template v-if="$route.name != 'writer-home'">
        <Button
          v-if="isLoggedIn"
          variant="solid"
          size="md"
          @click="$router.replace({ name: 'writer-home' })"
        >
          <div class="flex gap-2"><LucideHome class="size-4" />Go home</div>
        </Button>
        <Button v-else variant="solid" size="md" @click="redirectLogin()">
          <div class="flex gap-2"><LucideUser class="size-4" />Login</div>
        </Button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { Button } from 'frappe-ui'

import { useSessionStore } from '@/boot/session'
import { computed, watchEffect } from 'vue'
const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
import LucideFileUser from '~icons/lucide/file-user'
import LucideFileQuestionMark from '~icons/lucide/file-question-mark'
import LucideHome from '~icons/lucide/home'
import LucideUser from '~icons/lucide/user'

import { useRoute } from 'vue-router'

const props = defineProps({ error: [Object, String] })
const route = useRoute()

// Drive answers `DriveNotFound` when the caller cannot read a node at all, and
// `DriveForbidden` when they can read it but not do what they asked.
const forbidden = computed(() => props.error?.type === 'DriveForbidden')
const refused = computed(() => forbidden.value || props.error?.type === 'DriveNotFound')

const redirectLogin = () =>
  (window.location.href = `/login?redirect-to=${encodeURIComponent(route.fullPath)}`)

// A guest may be refused only because they are not signed in.
watchEffect(() => {
  if (refused.value && !isLoggedIn.value) redirectLogin()
})
</script>
