<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

import MentionPerson from '@/apps/writer/components/MentionPerson.vue'
import { searchMentions, useUsers } from '@/apps/writer/composables/useUsers'
import type { WriterUser } from '@/apps/writer/drive'
import { translate as __ } from '@/platform/translation'

const MAX_SHOWN = 6
const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 }

// The suggestion plugin passes all its props; only these two are the menu's
defineOptions({ inheritAttrs: false })

/** The document's `@` menu: the people the comment box offers, ranked for this document. */
const props = defineProps<{ query: string; command: (person: WriterUser) => void }>()

const { users, answeredQuery } = useUsers()
const listId = useId()
const list = ref<HTMLElement | null>(null)
const active = ref(0)

const offered = computed(() => users.value.slice(0, MAX_SHOWN))
// Rows from an older query stay shown, faded, until the answer to this one arrives
const isAnswerCurrent = computed(() => answeredQuery.value === props.query)

watch(() => props.query, searchMentions, { immediate: true })
watch(users, () => {
  active.value = 0
})

function optionId(index: number) {
  return `${listId}-${index}`
}

function optionClass(index: number) {
  const tint = index === active.value ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2'
  return isAnswerCurrent.value ? tint : `${tint} opacity-60`
}

async function move(step: number) {
  const count = Math.max(offered.value.length, 1)
  active.value = (active.value + step + count) % count
  await nextTick()
  list.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({
    block: 'nearest',
  })
}

/** The editor's keys while the menu is open; true when the key was the menu's. */
function onKeyDown({ event }: { event: KeyboardEvent }) {
  if (!offered.value.length) return false
  const step = STEPS[event.key]
  if (step) {
    void move(step)
    return true
  }

  if (event.key !== 'Enter' && event.key !== 'Tab') return false
  const person = offered.value[active.value]
  if (person && isAnswerCurrent.value) props.command(person)
  return true
}

defineExpose({ onKeyDown })
</script>

<template>
  <div
    :id="listId"
    ref="list"
    role="listbox"
    :aria-label="__('People')"
    :aria-busy="!isAnswerCurrent"
    class="max-h-56 w-72 overflow-y-auto rounded-6 border border-outline-gray-2 bg-surface-elevation-2 p-1 shadow-lg"
  >
    <button
      v-for="(person, index) in offered"
      :id="optionId(index)"
      :key="person.name"
      type="button"
      role="option"
      tabindex="-1"
      class="flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left text-sm"
      :class="optionClass(index)"
      :aria-selected="index === active"
      @mousedown.prevent="command(person)"
      @mouseenter="active = index"
    >
      <MentionPerson :person="person" />
    </button>
    <p
      v-if="!offered.length"
      role="option"
      aria-disabled="true"
      class="px-2 py-1.5 text-sm text-ink-gray-5"
    >
      {{ isAnswerCurrent ? __('No people found') : __('Searching…') }}
    </p>
  </div>
</template>
