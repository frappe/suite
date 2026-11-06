<template>
  <!-- A filter's answers, one to pick: a menu's rows, in a popup on a desktop and a sheet on a phone. -->
  <div class="max-h-72 space-y-0.5 overflow-y-auto">
    <button
      v-for="choice in choices"
      :key="choice.value"
      class="hover:bg-surface-gray-2 active:bg-surface-gray-2 text-ink-gray-8 flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left text-base sm:text-sm"
      @click="emit('pick', choice.value)"
    >
      <span class="flex-1 truncate">{{ choice.label }}</span>
      <span
        v-if="choice.value === selected"
        class="lucide-check text-ink-gray-6 size-4 shrink-0"
        :aria-label="__('Selected')"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ choices: { label: string; value: string }[]; selected?: string }>()
const emit = defineEmits<{ pick: [value: string] }>()
</script>
