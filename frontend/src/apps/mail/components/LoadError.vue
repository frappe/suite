<template>
  <!-- What a page or list shows in place of what failed to load: what went wrong, and a way to ask
       again. Shared by the thread lists, the Outbox and a submission's details. -->
  <div role="alert" class="flex flex-col items-center justify-center gap-4 px-4 py-10 text-center">
    <div class="flex flex-col gap-1">
      <p class="text-p-base-medium text-ink-gray-8">{{ title }}</p>
      <p v-if="error?.message" class="text-p-sm text-ink-gray-5">{{ error.message }}</p>
    </div>
    <div class="flex flex-wrap justify-center gap-2">
      <slot />
      <Button :label="__('Retry')" :loading="retrying" @click="emit('retry')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

defineProps<{
  title: string
  error?: Error | null
  retrying?: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
</script>
