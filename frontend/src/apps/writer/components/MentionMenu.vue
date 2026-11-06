<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'

import MentionList from '@/apps/writer/components/MentionList.vue'
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
const list = useTemplateRef<InstanceType<typeof MentionList>>('list')
const active = ref(0)

const offered = computed(() => users.value.slice(0, MAX_SHOWN))
const isAnswerCurrent = computed(() => answeredQuery.value === props.query)

watch(() => props.query, searchMentions, { immediate: true })
watch(users, () => {
  active.value = 0
})

async function move(step: number) {
  const count = Math.max(offered.value.length, 1)
  active.value = (active.value + step + count) % count
  await nextTick()
  const listElement: HTMLElement | undefined = list.value?.$el
  listElement?.querySelector(`#${CSS.escape(`${listId}-${active.value}`)}`)?.scrollIntoView({
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
  <MentionList
    :id="listId"
    ref="list"
    class="w-72"
    :people="offered"
    :active
    :is-current="isAnswerCurrent"
    :empty-text="isAnswerCurrent ? __('No people found') : __('Searching…')"
    @pick="command"
    @hover="active = $event"
  />
</template>
