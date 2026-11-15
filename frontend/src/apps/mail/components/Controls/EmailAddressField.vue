<!-- One "username @ domain" row for creating an address, so every admin dialog that makes one asks for it the same way. -->
<script setup lang="ts">
import { FormControl } from 'frappe-ui'
import { computed, useId } from 'vue'

import { translate as __ } from '@/platform/translation'

const username = defineModel<string>('username', { required: true })
const domain = defineModel<string>('domain', { required: true })
const { domains, label, description, usernamePlaceholder } = defineProps<{
  /** The domains an address can be made on. */
  domains: readonly string[]
  /** Defaults to "Email address". */
  label?: string
  description?: string
  usernamePlaceholder?: string
}>()
defineSlots<{
  /** Trailing controls on the address row, such as a remove button. */
  default?: () => unknown
}>()

// The separator of an email address, the same in every language.
const AT = '@'
const labelId = useId()
// Each part names the row it sits in, so a primary address and its aliases stay told apart.
const rowLabel = computed(() => label ?? __('Email address'))
const domainOptions = computed(() => domains.map((name) => ({ label: name, value: name })))
</script>

<template>
  <div role="group" :aria-labelledby="labelId" class="space-y-1.5">
    <p :id="labelId" class="text-ink-gray-6 leading-tighter text-sm">{{ rowLabel }}</p>
    <div class="flex items-center gap-2">
      <FormControl
        v-model="username"
        class="min-w-0 flex-1"
        :placeholder="usernamePlaceholder ?? 'team'"
        autocomplete="off"
        :aria-label="__('{0} username', [rowLabel])"
      />
      <span class="text-ink-gray-6 shrink-0 text-base" aria-hidden="true">{{ AT }}</span>
      <FormControl
        v-model="domain"
        type="select"
        class="min-w-0 flex-1"
        :placeholder="__('Select a domain')"
        :options="domainOptions"
        :aria-label="__('{0} domain', [rowLabel])"
      />
      <slot />
    </div>
    <p v-if="description" class="text-ink-gray-6 text-p-sm">{{ description }}</p>
  </div>
</template>
