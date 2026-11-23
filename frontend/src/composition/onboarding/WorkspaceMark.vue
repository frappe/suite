<!-- The workspace's logo, or its first letter on a dark tile when it has none. -->
<script setup lang="ts">
import { computed } from 'vue'

const {
  name,
  logo,
  size = 'md',
} = defineProps<{
  name: string
  logo?: string | null
  size?: 'md' | 'lg'
}>()

const initial = computed(() => name.trim().charAt(0).toUpperCase())
const box = computed(() =>
  size === 'lg' ? 'size-16 rounded-5 text-2xl' : 'size-8 rounded-[8px] text-base',
)
</script>

<template>
  <img
    v-if="logo"
    :src="logo"
    :alt="__('{0} logo', [name])"
    class="shrink-0 object-contain"
    :class="box"
    draggable="false"
  />
  <div
    v-else
    class="flex shrink-0 items-center justify-center bg-surface-gray-7 font-semibold text-ink-gray-1"
    :class="box"
    role="img"
    :aria-label="name"
  >
    <span v-if="initial" aria-hidden="true">{{ initial }}</span>
    <span v-else class="lucide-building-2 size-1/2" aria-hidden="true" />
  </div>
</template>
