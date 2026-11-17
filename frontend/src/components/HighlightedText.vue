<template>
  <!-- A run of text with the search term marked in it, wherever a search lists what it found.
	     Segments rather than markup: nothing in a subject or a title is HTML here, so nothing
	     has to be escaped before the mark goes in. -->
  <template v-for="(segment, index) in segments" :key="index">
    <mark v-if="segment.hit" class="bg-surface-yellow-5 text-ink-gray-8">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { highlightSegments, type HighlightSegment } from '@/utils/highlight'

const props = defineProps<{
  text?: string
  term?: string
  /** Already cut, for words the server marked rather than a term to look for. */
  segments?: HighlightSegment[]
}>()

const segments = computed(
  () => props.segments ?? highlightSegments(props.text ?? '', props.term ?? ''),
)
</script>
