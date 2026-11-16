<template>
  <!-- What a page or list shows in place of what failed to load: what went wrong, and a way to ask
       again. Shared by the thread lists, the Outbox, a submission's details and a raw message.
       A refusal (not found, no access) offers no Retry: asking again gets the same answer. -->
  <div role="alert" class="flex flex-col items-center justify-center gap-4 px-4 py-10 text-center">
    <div class="flex flex-col gap-1">
      <p class="text-p-base-medium text-ink-gray-8">{{ title }}</p>
      <p v-if="description || error?.message" class="text-p-sm text-ink-gray-5">
        {{ description || error?.message }}
      </p>
    </div>
    <div class="flex flex-wrap justify-center gap-2">
      <slot />
      <Button
        v-if="!isRefusal(error)"
        :label="__('Retry')"
        :loading="retrying"
        @click="emit('retry')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

import { isRefusal } from '@/platform/transport'

defineProps<{
  title: string
  /** Said in place of the server's own message, when the page knows better what happened. */
  description?: string
  error?: Error | null
  retrying?: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
</script>
