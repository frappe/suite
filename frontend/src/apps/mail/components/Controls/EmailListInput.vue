<!-- Many email addresses in one field: typed or pasted, each becomes a chip, and one that is not an address is marked before anything is sent. -->
<script setup lang="ts">
import { computed, useId, useTemplateRef } from 'vue'

import { isEmail } from '@/apps/mail/utils'
import { translate as __ } from '@/platform/translation'

const addresses = defineModel<string[]>({ required: true })
/** What is typed but not yet a chip; it becomes one on blur, which comes before a click on Add. */
const draft = defineModel<string>('draft', { default: '' })
const { label, description, placeholder } = defineProps<{
  label: string
  description?: string
  placeholder?: string
}>()

const input = useTemplateRef('input')
const labelId = useId()
const descriptionId = useId()
const invalidCount = computed(() => addresses.value.filter((value) => !isEmail(value)).length)

// Commas, semicolons, spaces and line breaks all separate addresses, so a pasted list splits itself.
function add(text: string) {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return
  addresses.value = [...new Set([...addresses.value, ...parts])]
}

function commitDraft() {
  add(draft.value)
  draft.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (['Enter', ',', ';', ' ', 'Tab'].includes(event.key) && draft.value.trim()) {
    event.preventDefault()
    commitDraft()
  } else if (event.key === 'Backspace' && !draft.value && addresses.value.length) {
    addresses.value = addresses.value.slice(0, -1)
  }
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  if (!/[\s,;]/.test(text)) return
  event.preventDefault()
  add(draft.value + text)
  draft.value = ''
}

function remove(address: string) {
  addresses.value = addresses.value.filter((value) => value !== address)
  input.value?.focus()
}
</script>

<template>
  <div class="space-y-1.5">
    <p :id="labelId" class="text-ink-gray-6 leading-tighter text-sm">{{ label }}</p>
    <div
      class="bg-surface-gray-2 focus-within:ring-outline-gray-3 flex min-h-7 cursor-text flex-wrap items-center gap-1 rounded-4 p-1 focus-within:ring-2"
      @click="input?.focus()"
    >
      <span
        v-for="address in addresses"
        :key="address"
        class="flex min-w-0 items-center gap-1 rounded-4 border py-0.5 pl-1.5 pr-0.5 text-base"
        :class="
          isEmail(address)
            ? 'bg-surface-white border-outline-gray-2 text-ink-gray-8'
            : 'bg-surface-red-2 border-outline-red-2 text-ink-red-7'
        "
        :title="isEmail(address) ? undefined : __('Not an email address')"
      >
        <span class="truncate">{{ address }}</span>
        <button
          type="button"
          class="text-ink-gray-5 hover:text-ink-gray-8 flex size-4 shrink-0 items-center justify-center rounded-4"
          :aria-label="__('Remove {0}', [address])"
          @click.stop="remove(address)"
        >
          <span class="lucide-x size-3" aria-hidden="true" />
        </button>
      </span>
      <input
        ref="input"
        v-model="draft"
        type="email"
        multiple
        autocomplete="off"
        class="text-ink-gray-8 placeholder:text-ink-gray-4 min-w-32 flex-1 border-0 bg-transparent px-1 py-0.5 text-base focus:ring-0"
        :placeholder="addresses.length ? '' : placeholder"
        :aria-labelledby="labelId"
        :aria-describedby="description || invalidCount ? descriptionId : undefined"
        @keydown="onKeydown"
        @paste="onPaste"
        @blur="commitDraft"
      />
    </div>
    <p v-if="invalidCount" :id="descriptionId" class="text-ink-red-5 text-p-sm" role="alert">
      {{
        invalidCount === 1
          ? __('One entry is not an email address. Fix or remove it.')
          : __('{0} entries are not email addresses. Fix or remove them.', [invalidCount])
      }}
    </p>
    <p v-else-if="description" :id="descriptionId" class="text-ink-gray-6 text-p-sm">
      {{ description }}
    </p>
  </div>
</template>
