<!-- A full-screen Meet status: an icon in a tinted circle, a title, a line of explanation and one action. Every screen that stands in for the call (could not join, moved away, waiting to be let in) uses it, so they read as one family. -->
<script setup lang="ts">
import { Button } from 'frappe-ui'

const {
  icon,
  tone = 'neutral',
  title,
  description,
  actionLabel,
  actionIcon,
} = defineProps<{
  icon: string
  tone?: 'neutral' | 'danger' | 'warning'
  title: string
  description: string
  actionLabel: string
  actionIcon?: string
}>()
defineEmits<{ action: [] }>()

const TONES = {
  neutral: 'bg-surface-gray-2 text-ink-gray-5',
  danger: 'bg-surface-red-2 text-ink-red-4',
  warning: 'bg-surface-amber-2 text-ink-amber-6',
}
</script>

<template>
  <div class="grid flex-1 place-items-center px-5 py-16" role="status">
    <div class="flex w-full max-w-sm flex-col items-center text-center">
      <div class="rounded-full p-3" :class="TONES[tone]">
        <span :class="icon" class="block size-6" aria-hidden="true" />
      </div>
      <h1 class="text-ink-gray-9 mt-4 text-xl-semibold">{{ title }}</h1>
      <p class="text-ink-gray-6 text-p-base mt-2">{{ description }}</p>
      <Button
        class="mt-6"
        variant="solid"
        theme="gray"
        :icon-left="actionIcon"
        :label="actionLabel"
        @click="$emit('action')"
      />
    </div>
  </div>
</template>
