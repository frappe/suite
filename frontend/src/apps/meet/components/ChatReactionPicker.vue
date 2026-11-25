<template>
  <EmojiPicker side="top" align="end" @select="selectReaction">
    <Button
      variant="ghost"
      size="xs"
      icon="lucide-smile-plus"
      :label="__('Add reaction')"
      :tooltip="__('Add reaction')"
    />
  </EmojiPicker>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'

import EmojiPicker from '@/platform/emoji-picker/EmojiPicker.vue'
import { translate as __ } from '@/platform/translation'

import { isChatReaction } from '../../../../../suite/meet/types/chatReactions'

const emit = defineEmits<{ select: [emoji: string] }>()

function selectReaction(emoji: string) {
  if (isChatReaction(emoji)) emit('select', emoji)
}
</script>
