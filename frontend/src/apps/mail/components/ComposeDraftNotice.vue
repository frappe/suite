<template>
  <!-- What the writer has to decide about this draft, when there is something. It sits above the
       fields, in every composer, until it is decided. -->
  <div v-if="isGone || copy" class="shrink-0 border-b p-2">
    <Alert
      v-if="isGone"
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
    <Alert
      v-else-if="copy"
      theme="blue"
      :title="__('Unsaved changes on this device')"
      :description="copyDescription"
      :primary-action="{ label: __('Restore'), onClick: () => emit('restore') }"
      :secondary-action="{ label: __('Ignore'), onClick: () => emit('ignore') }"
    />
  </div>
</template>

<script setup lang="ts">
import { Alert } from 'frappe-ui'
import { computed } from 'vue'

import dayjs from '@/apps/mail/utils/dayjs'
import type { DraftCopy } from '@/apps/mail/utils/draftCopies'

const { isGone = false, copy } = defineProps<{ isGone?: boolean; copy?: DraftCopy }>()
const emit = defineEmits(['keepAsNew', 'discard', 'restore', 'ignore'])

const copyDescription = computed(() => {
  if (!copy) return ''
  const when = __('From {0}, when saving failed.', [dayjs(copy.savedAt).fromNow()])
  return copy.uploading.length
    ? `${when} ${__('Files still uploading then are not included: {0}', [copy.uploading.join(', ')])}`
    : when
})
</script>
