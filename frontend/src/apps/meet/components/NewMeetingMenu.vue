<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    variant?: 'solid' | 'subtle'
    size?: 'sm' | 'md'
  }>(),
  { variant: 'solid', size: 'sm' },
)
const emit = defineEmits<{ instant: []; restricted: []; schedule: [] }>()
const options = computed(() => [
  {
    label: 'Create a restricted meeting',
    icon: 'lucide-lock',
    onClick: () => emit('restricted'),
    disabled: props.loading,
  },
  { label: 'Schedule a meeting', icon: 'lucide-calendar-plus', onClick: () => emit('schedule') },
])
</script>

<template>
  <div class="new-meeting-split inline-flex shrink-0" role="group" aria-label="New meeting">
    <Button
      data-slot="new-meeting-primary"
      label="New meeting"
      icon-left="lucide-video"
      :variant="variant"
      :size="size"
      :loading="loading"
      :disabled="loading"
      @click="emit('instant')"
    />
    <Dropdown
      :options="options"
      :button="{ icon: 'lucide-chevron-down', variant, size, disabled: loading }"
      aria-label="More meeting options"
    />
  </div>
</template>

<style scoped>
.new-meeting-split :deep([data-slot='new-meeting-primary']) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.new-meeting-split :deep([data-slot='trigger']) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
</style>
