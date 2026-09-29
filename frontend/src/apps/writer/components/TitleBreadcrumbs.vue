<template>
  <div class="flex min-w-0 items-center" data-testid="breadcrumbs">
    <template v-if="editing">
      <template v-if="items.length > 1">
        <Breadcrumbs class="parent-breadcrumbs" :items="items.slice(0, -1)" />
        <span class="mx-0.5 text-base text-ink-gray-4" aria-hidden="true">/</span>
      </template>
      <input
        ref="input"
        v-model="draft"
        type="text"
        spellcheck="false"
        aria-label="Document title"
        style="field-sizing: content"
        class="min-w-[4ch] max-w-full rounded-1 border-0 bg-surface-base px-0.5 py-1 text-lg-medium text-ink-gray-9 shadow-[inset_0_0_0_1px_var(--outline-gray-4)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        @keydown.enter.prevent="submit"
        @keydown.escape.prevent="editing = false"
        @blur="onBlur"
      />
    </template>
    <Breadcrumbs v-else :items="items" />
  </div>
</template>

<script setup lang="ts">
import { Breadcrumbs, toast } from 'frappe-ui'
import { inject, nextTick, ref, useTemplateRef, watch } from 'vue'

import { RENAME_DOCUMENT } from '@/apps/writer/renameDocument'

interface Crumb {
  label: string
  href?: string
  onClick?: () => void
}

const props = defineProps<{ items: Crumb[]; title: string }>()
const editing = defineModel<boolean>('editing', { default: false })

const renameDocument = inject(RENAME_DOCUMENT, null)
const input = useTemplateRef<HTMLInputElement>('input')
const draft = ref('')
let openedAt = 0

// Clicking the title crumb removes it from the DOM, which takes focus away from
// the new field a tick later. Focus lost inside this window is reclaimed, not
// treated as a commit.
const OPEN_GRACE_MS = 600

function focusField() {
  const field = input.value
  if (!field || !editing.value) return
  if (document.activeElement !== field) field.focus()
  field.select()
}

watch(editing, (open) => {
  if (!open) return
  draft.value = props.title
  openedAt = performance.now()
  nextTick(focusField)
  setTimeout(focusField, 0)
  requestAnimationFrame(focusField)
})

function onBlur() {
  if (performance.now() - openedAt < OPEN_GRACE_MS) {
    nextTick(focusField)
    return
  }
  submit()
}

function submit() {
  if (!editing.value) return
  editing.value = false
  const title = draft.value.trim()
  if (!title || title === props.title || !renameDocument) return
  renameDocument(title).catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : 'Could not rename this file.')
  })
}
</script>

<style scoped>
.parent-breadcrumbs :deep(a) {
  color: var(--ink-gray-5);
}
</style>
