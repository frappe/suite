<template>
  <!-- Why a conversation is on the list: what its newest match says around the words searched for.
       Segments, not markup, so nothing a mail wrote is ever taken for HTML. -->
  <span :class="wrap ? 'line-clamp-2 whitespace-normal' : undefined">
    <span v-if="match.in_attachment" class="text-ink-gray-6">{{ __('In an attachment') }} · </span>
    <HighlightedText :segments="match.snippet ?? []" />
  </span>
</template>

<script setup lang="ts">
import type { SearchMatch } from '@/apps/mail/types'

defineProps<{
  match: SearchMatch
  /** Let it run to two lines rather than cut at one. */
  wrap?: boolean
}>()
</script>
