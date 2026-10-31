<template>
  <div class="flex rounded-4 has-[:focus-visible]:focus-ring">
    <Button
      variant="solid"
      class="rounded-r-none focus-visible:outline-none max-md:hidden"
      icon-left="lucide-play"
      label="Present"
      :disabled="isDisabled"
      @click="emit('start', {})"
    />
    <Button
      variant="solid"
      class="rounded-r-none focus-visible:outline-none md:hidden"
      icon="lucide-play"
      tooltip="Present"
      aria-label="Present"
      :disabled="isDisabled"
      @click="emit('start', {})"
    />
    <Dropdown :options="options" align="end" :disabled="isDisabled">
      <Button
        variant="solid"
        icon="lucide-chevron-down"
        aria-label="Presentation options"
        class="divider rounded-l-none border-l-[0.5px] focus-visible:outline-none data-[state=open]:bg-surface-gray-10"
      />
    </Dropdown>
  </div>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'

import type { startSlideShow } from '@/apps/slides/stores/slideshow'

defineProps<{ isDisabled?: boolean }>()

const emit = defineEmits<{ start: [options: NonNullable<Parameters<typeof startSlideShow>[0]>] }>()

const options = [
  {
    label: 'From the start',
    icon: 'lucide-skip-back',
    onClick: () => emit('start', { fromStart: true }),
  },
  {
    label: 'On loop',
    icon: 'lucide-repeat-2',
    onClick: () => emit('start', { loop: true }),
  },
]
</script>

<style scoped>
.divider {
  border-left-color: color-mix(in oklch, currentColor 20%, transparent);
}
</style>
