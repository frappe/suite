<script setup lang="ts">
import { Tooltip } from 'frappe-ui'

/** When the document was edited, with the exact details on hover. */
defineOptions({ inheritAttrs: false })
defineProps<{ text: string; details: readonly string[] }>()
</script>

<template>
  <Tooltip :disabled="!details.length">
    <span v-bind="$attrs">{{ text }}</span>
    <template #content>
      <p v-for="line in details" :key="line">{{ line }}</p>
    </template>
  </Tooltip>
</template>
