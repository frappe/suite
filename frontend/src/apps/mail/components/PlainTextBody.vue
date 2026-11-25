<template>
  <div>
    <template v-for="(segment, index) in segments" :key="index">
      <template v-if="segment.kind === 'quote'">
        <!-- A quiet outlined pill, as an HTML mail's quoted trail has (see EmailContent) -->
        <button
          type="button"
          class="border-outline-gray-2 text-ink-gray-5 hover:bg-surface-gray-2 active:bg-surface-gray-2 my-3 inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-sm [-webkit-tap-highlight-color:transparent] max-sm:h-8 max-sm:px-3 max-sm:text-base"
          :aria-expanded="expanded.has(index)"
          @click="toggle(index)"
        >
          <Ellipsis class="size-3.5" aria-hidden="true" />
          {{ expanded.has(index) ? __('Hide quoted text') : __('Show quoted text') }}
        </button>
        <div v-if="expanded.has(index)">
          <LinkifiedText
            v-for="(block, level) in segment.blocks"
            :key="level"
            :text="block.text"
            class="border-outline-gray-2 text-ink-gray-6 my-1 border-l pl-3"
            :style="{ marginLeft: (block.depth - 1) * 12 + 'px' }"
            :term
          />
        </div>
      </template>
      <LinkifiedText
        v-else-if="segment.kind === 'signature'"
        :text="segment.blocks[0].text"
        class="text-ink-gray-5 mt-3"
        :term
      />
      <LinkifiedText
        v-else
        :text="segment.blocks[0].text"
        :term
        :marks="dates[index]"
        :mark-label="__('Create event')"
        @pick="emit('pickDate', dates[index][$event])"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { Ellipsis } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import { mailReader, useMailDates } from '@/apps/mail/composables/useMailDates'
import type { NamedDate } from '@/apps/mail/utils/mailDates'
import { groupPlainText, withoutQuoteLead } from '@/apps/mail/utils/plainTextBlocks'
import LinkifiedText from '@/components/LinkifiedText.vue'

// `term`: the words a search found the message by, marked in it. `sentAt`: when the mail was
// sent; given it, the dates in the mail's own words are marked, read from then, and picking one
// asks for an event at it (`pickDate`).
const { text, term, sentAt } = defineProps<{
  text?: string | null
  term?: string
  sentAt?: string
}>()
const emit = defineEmits<{ pickDate: [date: NamedDate] }>()
const segments = computed(() => groupPlainText(text ?? ''))

// The dates in each segment of the writer's own: not the signature, the quoted trail or the line
// that leads into it.
const mailDates = useMailDates()
const dates = computed(() =>
  segments.value.map((segment, index) => {
    if (!sentAt || !mailDates.value || segment.kind !== 'body') return []
    const leadsIntoQuote = segments.value[index + 1]?.kind === 'quote'
    const words = leadsIntoQuote ? withoutQuoteLead(segment.blocks[0].text) : segment.blocks[0].text
    return mailDates.value.findMailDates(words, sentAt, mailReader())
  }),
)
const expanded = ref(new Set<number>())

// Opening another message reuses this component, and the indices mean something else there.
watch(
  () => text,
  () => (expanded.value = new Set()),
)

const toggle = (index: number) => {
  const next = new Set(expanded.value)
  if (!next.delete(index)) next.add(index)
  expanded.value = next
}
</script>
