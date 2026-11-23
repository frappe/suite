<script setup lang="ts">
import { Button, Dropdown, type DropdownOptions } from 'frappe-ui'
import { computed, ref } from 'vue'

import { dayOrTime } from '@/platform/collab/versionDates'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import CommentText from './CommentText.vue'
import PersonAvatar from './PersonAvatar.vue'
import type { ShownDraft } from './useCommentDrafts'

/**
 * A comment sent but not yet taken by Drive, in the list like any other comment
 * while it posts, then "Not posted · Retry" with its words kept as they were sent.
 */
const props = defineProps<{ draft: ShownDraft; quote: string }>()
const emit = defineEmits<{ retry: []; discard: [] }>()

const me = useSession().user
const myName = computed(() => me.value?.fullName ?? __('You'))
const sentAt = dayOrTime({ creation: new Date().toISOString() })
const isOpen = ref(false)
const isMenuOpen = ref(false)
const isClosed = computed(() => !isOpen.value)
const isNotPosted = computed(() => !props.draft.isPosting)
const rowClass = computed(() => (isOpen.value ? 'bg-surface-gray-1' : 'hover:bg-surface-gray-1'))
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
  <li class="rounded-4" :class="rowClass">
    <div class="flex items-center gap-1.5 px-2 pt-2 text-xs text-ink-gray-5">
      <PersonAvatar :user="me?.id ?? 'Guest'" :name="myName" :image="me?.avatar ?? undefined" />
      <button
        type="button"
        class="min-w-0 truncate text-left text-sm-medium text-ink-gray-7"
        :aria-expanded="isOpen"
        @click="toggle"
      >
        {{ myName }}
      </button>
      <template v-if="isNotPosted">
        <span class="shrink-0">{{ __('Not posted ·') }}</span>
        <button
          type="button"
          class="shrink-0 text-ink-gray-8 hover:underline"
          @click="emit('retry')"
        >
          {{ __('Retry') }}
        </button>
      </template>
      <span v-else class="shrink-0">{{ sentAt }}</span>
    </div>
    <p
      v-if="quote"
      class="mx-2 mt-1 truncate border-l-2 border-outline-gray-3 pl-2 text-sm text-ink-gray-5"
      @click="toggle"
    >
      {{ quote }}
    </p>
    <p v-if="isClosed" class="truncate px-2 pb-2 pt-1 text-sm text-ink-gray-7" @click="toggle">
      <CommentText :content="draft.text" />
    </p>
    <div v-else class="px-2 pb-2 pt-1">
      <div class="group/comment relative">
        <p class="whitespace-pre-wrap pr-8 text-sm text-ink-gray-7">
          <CommentText :content="draft.text" />
        </p>
        <div v-if="isNotPosted" class="absolute -top-1.5 right-0" :class="menuClass">
          <Dropdown :options="actions" align="end" @update:open="noteMenu">
            <Button
              size="sm"
              variant="ghost"
              icon="lucide-ellipsis"
              :aria-label="__('More comment actions')"
            />
          </Dropdown>
        </div>
      </div>
    </div>
  </li>
</template>
