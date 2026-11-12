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

const text = computed(() => toParts(props.content, props.mentions).map(shownText).join(''))

function shownText(part: CommentPart) {
  if (part.user === null) {
    return part.text
  }

  const name = fullName(part.user)
  return `@${name}`
}
</script>

<template>{{ text }}</template>
