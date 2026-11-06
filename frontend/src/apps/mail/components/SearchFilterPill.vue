<template>
  <!-- One filter's chip and what it opens: anchored on a desktop, a sheet on a phone, where a popup at
       the screen's edge is out of the thumb's way. -->
  <Popover v-if="!isMobile" v-model:open="open" trigger="manual" side="bottom" align="start">
    <template #trigger>
      <SearchFilterChip :label :value @open="open = !open" @clear="emit('clear')" />
    </template>
    <div class="p-3" :class="width"><slot :close="close" /></div>
  </Popover>
  <template v-else>
    <SearchFilterChip :label :value @open="open = true" @clear="emit('clear')" />
    <BottomSheet v-model:open="open" :title="label">
      <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <slot :close="close" />
      </div>
    </BottomSheet>
  </template>
</template>

<script setup lang="ts">
import { BottomSheet, Popover } from 'frappe-ui'
import { ref } from 'vue'

import SearchFilterChip from '@/apps/mail/components/SearchFilterChip.vue'
import { useScreenSize } from '@/apps/mail/utils/composables'

const { width = 'w-72' } = defineProps<{
  /** The filter, as its chip reads while it isn't set. */
  label: string
  /** What it is set to, as the chip reads then. */
  value?: string
  /** How wide its popup stands on a desktop. */
  width?: string
}>()
const emit = defineEmits<{ clear: [] }>()

const { isMobile } = useScreenSize()
const open = ref(false)
const close = () => (open.value = false)
</script>
