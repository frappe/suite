<template>
  <!-- The advanced filters, in the palette rather than beside it: the query line above stays
	     where it was, and every field here writes the same filters the chips show. It takes the
	     result list's place while it is open — a form and the results it has not run yet are two
	     answers to the same question. -->
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="space-y-4 p-4">
      <FormControl
        v-if="!allAccounts"
        v-model="filter.inMailbox"
        type="select"
        :label="__('Look In')"
        :options="mailboxOptions"
      />
      <FormControl v-model="filter.subject" :label="__('Subject')" />
      <ContactCombobox v-model="filter.from" :label="__('From')" />
      <ContactCombobox v-model="filter.to" :label="__('To')" />
      <ContactCombobox v-model="filter.cc" :label="__('Cc')" />
      <ContactCombobox v-model="filter.bcc" :label="__('Bcc')" />
      <div class="flex space-x-4">
        <FormControl v-model="filter.after" type="date" :label="__('From Date')" class="w-full" />
        <FormControl v-model="filter.before" type="date" :label="__('To Date')" class="w-full" />
      </div>
      <div class="flex space-x-4">
        <FormControl
          v-model="filter.hasAttachment"
          type="select"
          :label="__('Attachments')"
          :options="attachmentOptions"
          class="w-full min-w-0"
        />
        <FormControl
          v-model="filter.isRead"
          type="select"
          :label="__('Read Status')"
          :options="readStatusOptions"
          class="w-full min-w-0"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FormControl } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

import ContactCombobox from '@/apps/mail/components/Controls/ContactCombobox.vue'
import { getAttachmentOptions, getReadStatusOptions } from '@/apps/mail/constants'
import { userStore } from '@/apps/mail/stores/user'

const FILTER_KEYS = [
  'inMailbox',
  'subject',
  'from',
  'to',
  'cc',
  'bcc',
  'after',
  'before',
  'hasAttachment',
  'isRead',
] as const

const filters = defineModel<Record<string, string>>('filters', {
  required: true,
})
// Where the search looks, which the page decides: a folder belongs to one account, so a search of
// every account has none to look in.
defineProps<{ allAccounts: boolean }>()

const { mailboxes } = userStore()

const attachmentOptions = getAttachmentOptions()
const readStatusOptions = getReadStatusOptions()

// A field per filter, because a form wants somewhere to put an empty string and the filters the
// palette holds only name the ones that are set. The fields are seeded once, on open — writing the
// trimmed filters back into them would take the space out from under a word being typed.
const filter = reactive<Record<string, string>>({
  ...Object.fromEntries(FILTER_KEYS.map((key) => [key, ''])),
  ...filters.value,
})

watch(filter, (value) => {
  filters.value = Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, entry.trim()])
      .filter(([, entry]) => Boolean(entry)),
  )
})

const mailboxOptions = computed(() =>
  [{ label: __('All folders'), value: '' }].concat(
    (mailboxes.data ?? []).map((mailbox: { id: string; _name: string }) => ({
      label: mailbox._name,
      value: mailbox.id,
    })),
  ),
)
</script>
