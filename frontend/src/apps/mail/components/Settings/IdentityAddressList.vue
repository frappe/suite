<!--
  A list of addresses on an identity (Reply to, Bcc): each with a remove button, and a field to add
  one more. Changes go to the identity's draft and save with it.
-->
<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-sm leading-tighter text-ink-gray-6">{{ label }}</span>
    <ul
      v-if="addresses.length"
      class="divide-y divide-outline-gray-1 rounded-6 border border-outline-gray-2"
    >
      <li
        v-for="(address, index) in addresses"
        :key="address.email"
        class="flex items-center gap-3 py-1 pl-3 pr-1"
      >
        <span class="min-w-0 flex-1 truncate text-base text-ink-gray-8">
          {{ address.display_name ? `${address.display_name} <${address.email}>` : address.email }}
        </span>
        <Button
          variant="ghost"
          icon="lucide-x"
          :aria-label="__('Remove {0}', [address.email])"
          @click="addresses = addresses.filter((_, i) => i !== index)"
        />
      </li>
    </ul>
    <form class="flex gap-2" @submit.prevent="add">
      <TextInput
        v-model="email"
        class="min-w-0 flex-1"
        type="email"
        :placeholder="__('name@example.com')"
        :aria-label="__('Address to add to {0}', [label])"
      />
      <Button type="submit" :label="__('Add')" :disabled="!canAdd" />
    </form>
    <p class="text-p-sm text-ink-gray-5">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
import { Button, TextInput } from 'frappe-ui'
import { computed, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

type Address = { email: string; display_name: string | null }

const addresses = defineModel<Address[]>({ required: true })
defineProps<{ label: string; description: string }>()

const email = ref('')
const canAdd = computed(() => {
  const value = email.value.trim()
  return value.includes('@') && !addresses.value.some((address) => address.email === value)
})
function add() {
  if (!canAdd.value) return
  addresses.value = [...addresses.value, { email: email.value.trim(), display_name: null }]
  email.value = ''
}
</script>
