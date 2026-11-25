<!-- A short list of email addresses, each with the name it is shown by: a row an address, added and removed one at a time. -->
<script setup lang="ts">
import { Button, FormControl } from 'frappe-ui'
import { computed, nextTick, onMounted, useId, useTemplateRef } from 'vue'

import { isEmail } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { translate as __ } from '@/platform/translation'

interface NamedAddress {
  email: string
  display_name: string
}

// Changed in place, not swapped for a new list: two fields filled in one go must both be kept
const addresses = defineModel<NamedAddress[]>({ required: true })
const { label, description, isChecked, autofocus } = defineProps<{
  label: string
  description?: string
  /** Whether a row whose email is no address says so, as it does once Save was pressed on it. */
  isChecked?: boolean
  /** Whether its last row is to be typed in as soon as the list shows, as when it was just asked for. */
  autofocus?: boolean
}>()

const labelId = useId()
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))

const rows = useTemplateRef<HTMLElement[]>('row')

// A row added is one to type in, starting with its email
async function focusLastRow() {
  await nextTick()
  rows.value?.at(-1)?.querySelector('input')?.focus()
}

onMounted(() => {
  if (autofocus) void focusLastRow()
})

function add() {
  addresses.value.push({ email: '', display_name: '' })
  void focusLastRow()
}

function remove(index: number) {
  addresses.value.splice(index, 1)
}

// A row left empty is no address yet, and is not sent, so it has nothing wrong to say
function errorOf(address: NamedAddress) {
  const isEmpty = !address.email.trim() && !address.display_name.trim()
  if (!isChecked || isEmpty || isEmail(address.email.trim())) {
    return undefined
  }

  return __('Enter a valid email address')
}

function removeLabel(address: NamedAddress) {
  if (!address.email) {
    return __('Remove address')
  }

  return __('Remove {0}', [address.email])
}
</script>

<template>
  <div class="flex flex-col gap-1.5" role="group" :aria-labelledby="labelId">
    <p :id="labelId" class="text-ink-gray-6 leading-tighter text-sm">{{ label }}</p>
    <p v-if="description" class="text-ink-gray-5 text-p-sm">{{ description }}</p>
    <div class="flex flex-col gap-1.5 max-sm:gap-3">
      <!-- On a phone the email takes a line of its own, as beside the name it is cut short; the
      remove button then goes with the pair, not with the name alone -->
      <div
        v-for="(address, index) in addresses"
        ref="row"
        :key="index"
        class="flex items-start gap-2"
      >
        <div class="flex min-w-0 flex-1 gap-2 max-sm:flex-col">
          <FormControl
            v-model="address.email"
            type="email"
            autocomplete="off"
            variant="outline"
            class="min-w-0 flex-1"
            :placeholder="__('name@example.com')"
            :aria-label="__('Email address')"
            :error="errorOf(address)"
          />
          <FormControl
            v-model="address.display_name"
            variant="outline"
            autocomplete="off"
            class="min-w-0 flex-1"
            :placeholder="__('Display name')"
            :aria-label="__('Display name')"
          />
        </div>
        <Button
          variant="ghost"
          icon="lucide-x"
          :size="buttonSize"
          class="max-sm:self-center"
          :aria-label="removeLabel(address)"
          @click="remove(index)"
        />
      </div>
    </div>
    <Button
      icon-left="lucide-plus"
      :label="__('Add address')"
      :size="buttonSize"
      class="self-start"
      @click="add"
    />
  </div>
</template>
