<template>
  <div class="flex">
    <Button
      icon-left="lucide-play"
      :label="__('Present')"
      class="rounded-r-none"
      :disabled="disabled"
      @click="startSlideShow()"
    />
    <Dropdown :options="options" align="end">
      <Button
        icon="lucide-chevron-down"
        :aria-label="__('Presentation options')"
        class="rounded-l-none border-l border-outline-gray-2"
        :disabled="disabled"
      />
    </Dropdown>
  </div>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'

import { startSlideShow } from '@/apps/slides/stores/slideshow'
import { translate as __ } from '@/platform/translation'

defineProps<{ disabled?: boolean }>()

const options = [
  {
    label: __('From the start'),
    icon: 'lucide-skip-back',
    onClick: () => startSlideShow({ fromStart: true }),
  },
  {
    label: __('On loop'),
    icon: 'lucide-repeat-2',
    onClick: () => startSlideShow({ loop: true }),
  },
]
</script>
