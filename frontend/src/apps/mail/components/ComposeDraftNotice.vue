<template>
  <!-- What the writer has to decide about this draft, when there is something. It sits above the
       fields, in every composer, until it is decided. -->
  <div v-if="isGone" class="shrink-0 border-b p-2">
    <Alert
      theme="amber"
      :title="__('This draft is no longer there')"
      :description="
        __(
          'It was sent, discarded or changed somewhere else. What you wrote here is still safe, and nothing else was overwritten.',
        )
      "
      :primary-action="{ label: __('Keep as a new draft'), onClick: () => emit('keepAsNew') }"
      :secondary-action="{ label: __('Discard'), onClick: () => emit('discard') }"
    />
  </div>
</template>

<script setup lang="ts">
import { Alert } from 'frappe-ui'

const { isGone = false } = defineProps<{ isGone?: boolean }>()
const emit = defineEmits(['keepAsNew', 'discard'])
</script>
