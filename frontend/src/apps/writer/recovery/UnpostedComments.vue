<script setup lang="ts">
import { computed } from 'vue'

import { anchorQuote } from '@/apps/writer/collab/anchors'
import { useSession } from '@/platform/session'

import { readDrafts } from './commentDrafts'

/** Comments this person wrote on the document and never posted, as kept on this device. */
const props = defineProps<{ node: string }>()

const { user } = useSession()
const drafts = computed(() => shownDrafts(user.value?.id ?? 'Guest', props.node))

function shownDrafts(person: string, node: string) {
  const written = readDrafts(person, node).filter((draft) => draft.text.trim())
  return written.map((draft) => ({ ...draft, quote: anchorQuote(draft.anchor) }))
}
</script>

<template>
  <section
    v-if="drafts.length"
    :aria-label="__('Comments not posted')"
    class="max-h-48 shrink-0 space-y-2 overflow-y-auto border-b border-outline-gray-2 px-5 py-3"
  >
    <h3 class="text-sm-medium text-ink-gray-7">{{ __('Comments not posted') }}</h3>
    <p class="text-p-sm text-ink-gray-5">
      {{ __("Kept on this device until you post or discard them in the document's comments") }}
    </p>
    <ul class="space-y-2">
      <li v-for="draft in drafts" :key="draft.clientId" class="space-y-1">
        <p v-if="draft.quote" class="truncate border-l-2 pl-2 text-sm text-ink-gray-5">
          {{ draft.quote }}
        </p>
        <p class="whitespace-pre-wrap text-p-sm text-ink-gray-8">{{ draft.text }}</p>
      </li>
    </ul>
  </section>
</template>
