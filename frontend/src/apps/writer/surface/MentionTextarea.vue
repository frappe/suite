<script setup lang="ts">
import { Textarea } from 'frappe-ui'
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'

import MentionList from '@/apps/writer/components/MentionList.vue'
import { fullName, lookUp, searchMentions, useUsers } from '@/apps/writer/composables/useUsers'
import type { WriterUser } from '@/apps/writer/drive'
import { isAuthenticated as isLoggedIn } from '@/platform/session'

import {
  fromTokens,
  isComposing,
  labelFor,
  mentionQuery,
  pickedIn,
  toTokens,
  type PickedPerson,
} from './commentMentions'

const MAX_SHOWN = 6
const MAX_LINES = 5

defineOptions({ inheritAttrs: false })

/**
 * A comment box where `@` picks a person. The box shows them as "@Name"; the
 * text it writes holds the `@[user]` mentions Drive notifies.
 */
const text = defineModel<string>({ required: true })
/** The people Drive found mentioned in the stored text; without it, every mention counts. */
const props = defineProps<{ mentions?: string[] }>()

const field = ref<{ focus(): void; inputElement: HTMLTextAreaElement | null } | null>(null)
const { users, answeredQuery } = useUsers()
const listId = useId()
const shown = ref('')
const query = ref<ReturnType<typeof mentionQuery>>(null)
const active = ref(0)
let picked: PickedPerson[] = []
/** The text this box last wrote, which tells its own writes from a new text. */
let written: string | null = null

const offered = computed(() => users.value.slice(0, MAX_SHOWN))
const isListOpen = computed(() => isLoggedIn.value && query.value !== null)
const isAnswerCurrent = computed(() => answeredQuery.value === query.value?.query)
const activeOption = computed(() => {
  if (!isListOpen.value || !offered.value.length) {
    return undefined
  }

  return `${listId}-${active.value}`
})

function showStored(value: string) {
  picked = pickedIn(value, fullName, props.mentions)
  shown.value = fromTokens(value, picked)
  written = value
}

// Names still loading show as user ids, then swap in unless the person has typed since
async function showNamesOnceKnown(value: string) {
  showStored(value)
  if (!picked.length) {
    return
  }

  await Promise.all(picked.map((person) => lookUp(person.user)))
  if (written === value) {
    showStored(value)
  }
}

watch(
  text,
  (value) => {
    if (value !== written) {
      void showNamesOnceKnown(value)
    }
  },
  { immediate: true },
)

watch(users, () => {
  active.value = 0
})

function write(value: string) {
  shown.value = value
  written = toTokens(value, picked)
  text.value = written
}

function caret() {
  return field.value?.inputElement?.selectionStart ?? shown.value.length
}

function onInput(value: string) {
  write(value)
  const found = mentionQuery(value, caret())
  if (found?.start !== query.value?.start) {
    active.value = 0
  }

  query.value = found
  if (found && isLoggedIn.value) {
    searchMentions(found.query)
  }
}

function closeList() {
  query.value = null
}

async function pick(person: WriterUser) {
  const found = query.value
  if (!found) {
    return
  }

  const label = labelFor(person.name, person.label, picked)
  picked = [...picked, { user: person.name, label }]
  const before = shown.value.slice(0, found.start)
  const after = shown.value.slice(found.start + found.query.length + 1)
  const inserted = `@${label} `
  write(before + inserted + after)
  closeList()
  await nextTick()
  const at = before.length + inserted.length
  field.value?.inputElement?.setSelectionRange(at, at)
}

function moveActive(step: number) {
  const count = offered.value.length
  active.value = (active.value + step + count) % Math.max(count, 1)
}

// The list's keys while it is open; true when the key was the list's
function takeListKey(key: string) {
  const [person] = offered.value.slice(active.value, active.value + 1)
  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
  if (step) {
    moveActive(step)
  } else if (key === 'Enter' || key === 'Tab') {
    if (person && isAnswerCurrent.value) {
      void pick(person)
    }
  } else if (key === 'Escape') {
    closeList()
  } else {
    return false
  }

  return true
}

function onKey(event: KeyboardEvent) {
  if (!isListOpen.value || isComposing(event) || event.shiftKey) {
    return
  }

  if (takeListKey(event.key)) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function focus() {
  field.value?.focus()
}

// Grows with the text up to MAX_LINES, then scrolls
function fitHeight() {
  const box = field.value?.inputElement
  if (!box) {
    return
  }

  box.style.height = 'auto'
  const style = getComputedStyle(box)
  const border = box.offsetHeight - box.clientHeight
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  const maxHeight = parseFloat(style.lineHeight) * MAX_LINES + padding + border
  const height = Math.min(box.scrollHeight + border, maxHeight)
  box.style.height = `${height}px`
  if (document.activeElement === box) {
    box.scrollIntoView({ block: 'nearest' })
  }
}

watch(shown, fitHeight, { flush: 'post' })
onMounted(fitHeight)

defineExpose({ focus })
</script>

<template>
  <div class="relative" @keydown.capture="onKey" @focusout="closeList">
    <Textarea
      ref="field"
      v-bind="$attrs"
      class="resize-none"
      :model-value="shown"
      role="combobox"
      aria-autocomplete="list"
      :aria-controls="listId"
      :aria-expanded="isListOpen"
      :aria-activedescendant="activeOption"
      @update:model-value="onInput"
      @click="closeList"
    />
    <MentionList
      v-if="isListOpen"
      :id="listId"
      class="absolute left-0 top-full z-50 mt-1 w-full"
      :people="offered"
      :active
      :is-current="isAnswerCurrent"
      :empty-text="__('No people found')"
      @pick="pick"
      @hover="active = $event"
    />
  </div>
</template>
