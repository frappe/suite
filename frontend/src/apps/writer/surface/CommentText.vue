<script setup lang="ts">
import { computed } from 'vue'

import { fullName } from '@/apps/writer/composables/useUsers'

import { toParts, type CommentPart } from './commentMentions'

/** A comment's text, with the people it mentions shown by name. */
const props = defineProps<{
  content: string
  /** The people Drive found mentioned; without it, everyone the text mentions. */
  mentions?: string[]
}>()

const parts = computed(() => toParts(props.content, props.mentions))

function mentionLabel(part: CommentPart) {
  const name = fullName(part.user ?? '')
  return `@${name}`
}

function isMention(part: CommentPart) {
  return part.user !== null
}
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <span v-if="isMention(part)" class="text-ink-blue-6">{{ mentionLabel(part) }}</span>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
