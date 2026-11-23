<!--
  The top line of a page inside a row dialog, such as one signature out of the list: an arrow back
  to the list, then the page's title.
-->
<template>
  <div class="flex items-center gap-2">
    <!-- Pulled out by its own padding, so the arrow starts on the line the fields start on -->
    <Button
      variant="ghost"
      icon="lucide-arrow-left"
      :aria-label="label"
      class="-ms-1.5"
      @click="emit('back')"
    />
    <h3 class="text-base-medium text-ink-gray-8 truncate">{{ title }}</h3>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

defineProps<{
  title: string
  /** The arrow's name, such as "Back to signatures". */
  label: string
}>()
const emit = defineEmits<{ back: [] }>()
</script>
