<!--
  Invite teammates on Suite Cloud. The invitation goes to a personal email, and
  each person gets a business mailbox, named after that email until the Admin
  changes it, on the domain the Admin picks (the supplied one by default).
  Everyone joins as a Normal User; Admins are added from Admin → Users.
-->
<script setup lang="ts">
import { Button, ErrorMessage, Select, TextInput } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

import { api, useMutation } from '@/api'

import { isEmail, mailboxName } from './onboarding'

const { domains } = defineProps<{ domains: readonly string[] }>()
const emit = defineEmits<{ sent: [count: number] }>()

interface Row {
  contact: string
  mailbox: string
  /** True once the Admin edits the mailbox, so it stops following the email. */
  edited: boolean
  domain: string
  error: string
}

const MAX_ROWS = 8
const emptyRow = (): Row => ({
  contact: '',
  mailbox: '',
  edited: false,
  domain: domains[0] ?? '',
  error: '',
})
const rows = reactive<Row[]>([emptyRow()])
const invite = useMutation(api.mail.admin.members.create, { silent: true })

// The mailbox follows the email until edited, and a filled last row grows an empty one.
watch(
  () => rows.map((row) => row.contact),
  () => {
    for (const row of rows) if (!row.edited) row.mailbox = mailboxName(row.contact)
    const last = rows.at(-1)
    if (last && isEmail(last.contact) && rows.length < MAX_ROWS) rows.push(emptyRow())
  },
)

const ready = computed(() => rows.filter((row) => isEmail(row.contact) && row.mailbox))
const canSubmit = computed(() => ready.value.length > 0 && !invite.isPending)

function remove(index: number): void {
  rows.splice(index, 1)
  if (!rows.length) rows.push(emptyRow())
}

/** Sends every filled row. Rows that fail stay, with their reason, and the rest are cleared. */
async function submit(): Promise<void> {
  let sent = 0
  for (const row of ready.value) {
    row.error = ''
    try {
      await invite.run({
        username: row.mailbox,
        domain: row.domain,
        backup_email: row.contact.trim(),
        is_admin: false,
        send_invite: true,
      })
      row.contact = ''
      sent += 1
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error)
    }
  }
  const failed = rows.filter((row) => row.error)
  rows.splice(0, rows.length, ...failed, emptyRow())
  if (!failed.length) emit('sent', sent)
}

defineExpose({ canSubmit, working: computed(() => invite.isPending), submit })
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-p-sm text-ink-gray-6">
      {{
        __(
          'We send the invitation to a personal email. Each person gets a business mailbox and joins as a Normal User.',
        )
      }}
    </p>
    <div v-for="(row, index) in rows" :key="index" class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <TextInput
          v-model="row.contact"
          class="flex-1"
          variant="outline"
          type="email"
          :placeholder="'alice@gmail.com'"
          :aria-label="__('Personal email {0}', [index + 1])"
          :disabled="invite.isPending"
        />
        <Button
          v-if="rows.length > 1 && row.contact"
          variant="ghost"
          icon="lucide-x"
          :aria-label="__('Remove')"
          @click="remove(index)"
        />
      </div>
      <div
        v-if="isEmail(row.contact)"
        class="flex items-center gap-1.5 pl-1 text-sm text-ink-gray-5"
      >
        <span class="lucide-corner-down-right size-3.5 shrink-0" aria-hidden="true" />
        <template v-if="!row.edited">
          <span class="truncate">{{ __('Mailbox {0}', [`${row.mailbox}@${row.domain}`]) }}</span>
          <Button size="xs" variant="ghost" :label="__('Change')" @click="row.edited = true" />
        </template>
        <template v-else>
          <TextInput
            v-model="row.mailbox"
            size="sm"
            variant="outline"
            class="min-w-0 flex-1"
            :aria-label="__('Business address {0}', [index + 1])"
          >
            <template v-if="domains.length === 1" #suffix>
              <span class="truncate text-sm text-ink-gray-5">{{ `@${row.domain}` }}</span>
            </template>
          </TextInput>
          <Select
            v-if="domains.length > 1"
            v-model="row.domain"
            size="sm"
            variant="outline"
            class="w-40 shrink-0"
            :options="domains.map((value) => ({ label: `@${value}`, value }))"
            :aria-label="__('Domain for invitation {0}', [index + 1])"
          />
        </template>
      </div>
      <ErrorMessage v-if="row.error" class="pl-1" :message="row.error" />
    </div>
  </div>
</template>
