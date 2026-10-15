<script setup lang="ts">
import { Button, Textarea } from 'frappe-ui'
import { computed, onMounted, ref } from 'vue'

import { anchorQuote } from '@/apps/writer/collab/anchors'

import type { ShownDraft } from './useCommentDrafts'

const props = defineProps<{ draft: ShownDraft }>()
const emit = defineEmits<{ write: [text: string]; post: []; discard: [] }>()

const field = ref<InstanceType<typeof Textarea> | null>(null)
const quote = computed(() => anchorQuote(props.draft.anchor))
const isPostDisabled = computed(() => props.draft.isPosting || !props.draft.text.trim())
const postLabel = computed(() => (props.draft.isPosting ? 'Posting…' : 'Comment'))

onMounted(() => field.value?.focus())
</script>

<template>
  <form class="space-y-2 rounded-4 bg-surface-gray-1 p-3" @submit.prevent="emit('post')">
    <p v-if="quote" class="truncate border-l-2 pl-2 text-p-sm text-ink-gray-5">{{ quote }}</p>
    <Textarea
      ref="field"
      :model-value="draft.text"
      :rows="2"
      :disabled="draft.isPosting"
      placeholder="Add a comment"
      aria-label="Comment on the text"
      @update:model-value="emit('write', $event)"
    />
    <div class="flex justify-end gap-1">
      <Button size="sm" variant="ghost" label="Discard" @click="emit('discard')" />
      <Button
        type="submit"
        size="sm"
        variant="solid"
        :label="postLabel"
        :disabled="isPostDisabled"
      />
    </div>
  </form>
</template>
