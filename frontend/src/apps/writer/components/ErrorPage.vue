<template>
  <div
    class="flex flex-col items-center h-screen p-6 text-center mt-[10%] w-full"
  >
    <div class="rounded-full flex items-center justify-center">
      <LucideFileUser v-if="error.type === 'PermissionError'" />
      <LucideFileQuestionMark v-else />
    </div>
    <h1 class="text-5xl-bold text-ink-gray-8 mt-4">Uh oh!</h1>
    <p class="text-xl text-ink-gray-5 mt-4">
      <template v-if="typeof error === 'string'">{{ error }}</template>
      <template v-else>
        {{
          error.type === 'PageDoesNotExistError'
            ? "This document doesn't exist."
            : 'You do not have access to this.'
        }}
      </template>
    </p>
    <div class="w-50 flex gap-8 my-12">
      <Button
        v-if="$router.options.history.state.back"
        variant="outline"
        size="md"
        @click="$router.go(-1)"
      >
        <div class="flex gap-2">
          <LucideArrowBigLeft class="size-4" />Go Back
        </div>
      </Button>
      <template v-if="$route.name != 'Home'">
        <Button
          v-if="isLoggedIn"
          variant="solid"
          size="md"
          @click="$router.replace({ name: 'writer-home' })"
        >
          <div class="flex gap-2"><LucideHome class="size-4" />Go Home</div>
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

const props = defineProps({ error: Object })

const redirectLogin = () => (window.location.href = '/drive/login')
watchEffect(() => {
  if (
    (String(props.error).includes('FORBIDDEN') ||
      props.error.exc_type === 'PermissionError') &&
    !isLoggedIn.value
  )
    redirectLogin()

})
</script>
