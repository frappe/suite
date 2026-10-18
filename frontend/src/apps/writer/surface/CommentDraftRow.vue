<script setup lang="ts">
import { Dropdown, type DropdownOptions } from 'frappe-ui'
import { computed, ref } from 'vue'

import { anchorQuote } from '@/apps/writer/collab/anchors'

import CommentText from './CommentText.vue'
import type { ShownDraft } from './useCommentDrafts'

/**
 * A comment sent but not yet taken by Drive, in the list as a faded row while
 * it posts, then "Not posted · Retry" with its words kept as they were sent.
 */
const props = defineProps<{ draft: ShownDraft }>()
const emit = defineEmits<{ retry: []; discard: [] }>()

const isOpen = ref(false)
const isMenuOpen = ref(false)
const quote = computed(() => anchorQuote(props.draft.anchor))
const isClosed = computed(() => !isOpen.value)
const isNotPosted = computed(() => !props.draft.isPosting)
const rowClass = computed(() => {
  if (props.draft.isPosting) {
    return 'opacity-60'
  }

  if (isOpen.value) {
    return 'bg-surface-elevation-3 shadow-sm'
  }

  return 'hover:bg-surface-gray-2'
})
const openClass = computed(() => {
  if (quote.value) {
    return 'pt-2'
  }

  return 'pt-1'
})
const menuClass = computed(() => {
  if (isMenuOpen.value) {
    return ''
  }

  return 'invisible group-hover/comment:visible group-focus-within/comment:visible'
})
const actions: DropdownOptions = [
  { label: 'Discard', icon: 'lucide-trash-2', onClick: () => emit('discard') },
]

function toggle() {
  isOpen.value = !isOpen.value
}

function noteMenu(isShown: boolean) {
  isMenuOpen.value = isShown
}
</script>

<template>
  <li class="rounded-4 transition-opacity duration-200" :class="rowClass">
    <div class="flex items-center gap-1.5 px-3 pt-2 text-xs text-ink-gray-5">
      <button
        type="button"
        class="min-w-0 text-left text-sm-medium text-ink-gray-8"
        :aria-expanded="isOpen"
        @click="toggle"
      >
        You
      </button>
      <span v-if="draft.isPosting" class="shrink-0">Posting…</span>
      <template v-else>
        <span class="shrink-0">Not posted ·</span>
        <button
          type="button"
          class="shrink-0 text-ink-gray-8 hover:underline"
          @click="emit('retry')"
        >
          Retry
        </button>
      </template>
    </div>
    <p
      v-if="quote"
      class="mx-3 mt-1 truncate border-l-2 pl-2 text-sm text-ink-gray-5"
      @click="toggle"
    >
      {{ quote }}
    </p>
    <p v-if="isClosed" class="truncate px-3 pb-2 pt-1 text-sm text-ink-gray-7" @click="toggle">
      <CommentText :content="draft.text" />
    </p>
    <div v-else class="px-3 pb-3" :class="openClass">
      <div class="group/comment relative">
        <p class="whitespace-pre-wrap pr-8 text-p-sm text-ink-gray-7">
          <CommentText :content="draft.text" />
        </p>
        <div v-if="isNotPosted" class="absolute -right-1.5 -top-1" :class="menuClass">
          <Dropdown :options="actions" align="end" @update:open="noteMenu">
            <button
              type="button"
              class="flex size-7 items-center justify-center text-ink-gray-5 hover:text-ink-gray-8"
              aria-label="More comment actions"
            >
              <span class="lucide-ellipsis size-4" aria-hidden="true" />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  </li>
</template>
