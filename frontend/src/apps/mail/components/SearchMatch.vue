<template>
  <!-- Why a conversation is on the list: what its newest match says around the words searched for.
       Segments, not markup, so nothing a mail wrote is ever taken for HTML. -->
  <span>
    <span v-if="match.in_attachment" class="text-ink-gray-6">{{ __('In an attachment') }} · </span>
    <HighlightedText :segments="match.snippet ?? []" />
  </span>
</template>

<script setup lang="ts">
import type { SearchMatch } from '@/apps/mail/types'

defineProps<{ match: SearchMatch }>()
</script>
