<template>
  <!-- A phone list's toolbar row while selecting: ✕ / count / Select All. It shares the regular
	     toolbar's h-12, so entering selection mode doesn't shift the list, and px-1/gap-1 match the
	     title row above, so the ✕ shares the menu button's axis and the count starts where the title
	     does. -->
  <div class="flex h-12 items-center gap-1 px-1">
    <Button variant="ghost" class="!h-10 !w-10 !rounded-full" @click="emit('toggleAll', false)">
      <template #icon><X class="icon !h-5 !w-5" /></template>
    </Button>
    <span class="flex-1 truncate text-base !font-medium">
      {{ __('{0} selected', [String(count)]) }}
    </span>
    <button
      class="text-ink-gray-8 text-md shrink-0 px-2 !font-medium"
      @click="emit('toggleAll', !allSelected)"
    >
      {{ allSelected ? __('Unselect All') : __('Select All') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { X } from 'lucide-vue-next'

const { count, allSelected } = defineProps<{ count: number; allSelected: boolean }>()
const emit = defineEmits<{ toggleAll: [selected: boolean] }>()
</script>
