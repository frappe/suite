<script setup lang="ts">
import MentionPerson from '@/apps/writer/components/MentionPerson.vue'
import type { WriterUser } from '@/apps/writer/drive'
import { translate as __ } from '@/platform/translation'

/**
 * The people an `@` offers. Rows from an older query stay shown, faded, until the
 * answer to this one arrives. Option ids are `${id}-${index}`.
 */
const props = defineProps<{
  id: string
  people: WriterUser[]
  active: number
  isCurrent: boolean
  emptyText: string
}>()
const emit = defineEmits<{ pick: [person: WriterUser]; hover: [index: number] }>()

function optionClass(index: number) {
  const tint = index === props.active ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2'
  return props.isCurrent ? tint : `${tint} opacity-60`
}
</script>

<template>
  <div
    :id
    role="listbox"
    :aria-label="__('People')"
    :aria-busy="!isCurrent"
    class="max-h-56 overflow-y-auto rounded-6 border border-outline-gray-2 bg-surface-elevation-2 p-1 shadow-lg"
  >
    <button
      v-for="(person, index) in people"
      :id="`${id}-${index}`"
      :key="person.name"
      type="button"
      role="option"
      tabindex="-1"
      class="flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left text-sm"
      :class="optionClass(index)"
      :aria-selected="index === active"
      @mousedown.prevent="emit('pick', person)"
      @mouseenter="emit('hover', index)"
    >
      <MentionPerson :person="person" />
    </button>
    <p
      v-if="!people.length"
      role="option"
      aria-disabled="true"
      class="px-2 py-1.5 text-sm text-ink-gray-5"
    >
      {{ emptyText }}
    </p>
  </div>
</template>
