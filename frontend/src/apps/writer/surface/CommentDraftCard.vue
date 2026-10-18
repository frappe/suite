<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, onMounted, ref } from 'vue'

import { anchorQuote, DOCUMENT_ANCHOR } from '@/apps/writer/collab/anchors'

import MentionTextarea from './MentionTextarea.vue'
import type { ShownDraft } from './useCommentDrafts'

const props = defineProps<{ draft: ShownDraft }>()
const emit = defineEmits<{ write: [text: string]; post: []; discard: [] }>()

const field = ref<InstanceType<typeof MentionTextarea> | null>(null)
const quote = computed(() => anchorQuote(props.draft.anchor))
const isPostDisabled = computed(() => !props.draft.text.trim())
const isOnDocument = computed(() => props.draft.anchor === DOCUMENT_ANCHOR)
const boxLabel = computed(() =>
  isOnDocument.value ? 'Add a comment' : 'Add a comment on the text',
)

function focus() {
  field.value?.focus()
}

onMounted(focus)
defineExpose({ focus })
</script>

<template>
  <form class="space-y-2 rounded-4 bg-surface-gray-1 p-3" @submit.prevent="emit('post')">
    <p v-if="quote" class="truncate border-l-2 pl-2 text-sm text-ink-gray-5">{{ quote }}</p>
    <MentionTextarea
      ref="field"
      :model-value="draft.text"
      :rows="2"
      placeholder="Add a comment"
      :aria-label="boxLabel"
      @update:model-value="emit('write', $event)"
      @keydown.esc.stop.prevent="emit('discard')"
    />
    <div class="flex justify-end gap-1">
      <Button size="sm" variant="ghost" label="Cancel" @click="emit('discard')" />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        label="Comment"
        :disabled="isPostDisabled"
      />
    </div>
  </form>
</template>
