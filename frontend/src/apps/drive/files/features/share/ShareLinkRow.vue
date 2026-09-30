<template>
  <li>
    <div class="flex min-h-12 items-center gap-3" :class="{ 'opacity-60': row.expired }">
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
        aria-hidden="true"
      >
        <span class="lucide-link size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-1.5 truncate">
          <span>{{ row.denied ? 'Share link' : `${roleLabel(row.grant.role)} link` }}</span>
          <span v-if="row.grant.has_password" class="lucide-lock size-3.5 text-ink-gray-5" aria-label="Password set" role="img" />
        </p>
        <p class="mt-1 truncate text-sm text-ink-gray-5">{{ meta }}</p>
      </div>
      <Button v-if="row.denied" label="Allow again" :loading="busy" @click="state.allowAgain(row)" />
      <template v-else-if="row.expired">
        <Button label="Delete link" theme="red" variant="ghost" :loading="busy" @click="state.remove(row)" />
      </template>
      <template v-else>
        <Button
          icon="lucide-copy"
          variant="ghost"
          aria-label="Copy link"
          tooltip="Copy link"
          :disabled="!row.grant.url"
          @click="row.grant.url && copyLink(row.grant.url)"
        />
        <Dropdown :options="options" align="end">
          <Button icon="lucide-ellipsis" variant="ghost" aria-label="Link options" :loading="busy" />
        </Dropdown>
      </template>
    </div>

    <form v-if="editing" class="flex items-center gap-2 pb-3 pl-10" @submit.prevent="save">
      <Password
        v-if="editing === 'password'"
        v-model="password"
        class="min-w-0 flex-1"
        placeholder="New password"
        aria-label="Link password"
        autocomplete="new-password"
      />
      <DatePicker v-else v-model="day" class="min-w-0 flex-1" placeholder="Expiry date" aria-label="Link expiry date" />
      <Button type="submit" variant="solid" label="Save" :loading="busy" :disabled="!ready" />
      <Button label="Cancel" @click="close" />
    </form>
    <ErrorMessage v-if="error" class="pb-2 pl-10" :message="error" />
  </li>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, DatePicker, Dropdown, ErrorMessage, Password, type DropdownItem } from 'frappe-ui'

import { roleLabel, rolesFor } from '@/apps/drive/client/grants'
import { confirm } from '@/platform/feedback'

import type { LocalRow } from './shareModel'
import { copyLink, formatDay, stampDay } from './shareFormat'
import type { ShareState } from './useShare'

/** One share link: its role, password and expiry, and the row menu (unified spec §7.7). */
const props = defineProps<{ row: LocalRow; state: ShareState; nodeKind: string }>()

const editing = ref<'password' | 'expiry' | null>(null)
const password = ref('')
const day = ref('')

const principal = computed(() => props.row.grant.principal)
const busy = computed(() => props.state.isPending(principal.value))
const error = computed(() => props.state.errors.get(principal.value))
const ready = computed(() => (editing.value === 'password' ? password.value !== '' : day.value !== ''))

const meta = computed(() => {
  const grant = props.row.grant
  // A deny on an inherited link: this link does not reach this item.
  if (props.row.denied) return 'Denied here'
  const parts: string[] = []
  if (props.row.expired && grant.expires_on) parts.push(`Expired ${formatDay(grant.expires_on)}`)
  else parts.push(grant.expires_on ? `Expires ${formatDay(grant.expires_on)}` : 'No expiry')
  if (grant.sent_to) parts.push(`sent to ${grant.sent_to}`)
  return parts.join(' · ')
})

const options = computed<DropdownItem[]>(() => {
  const grant = props.row.grant
  return [
    {
      label: 'Access',
      icon: 'lucide-user-cog',
      submenu: rolesFor('link', props.nodeKind).map((role) => ({
        label: role.label,
        selected: role.value === grant.role,
        onClick: () => void (role.value !== grant.role && props.state.setRole(props.row, role.value)),
      })),
    },
    {
      group: 'Password',
      hideLabel: true,
      options: [
        { label: grant.has_password ? 'Change password' : 'Set password', icon: 'lucide-lock', onClick: () => edit('password') },
        ...(grant.has_password
          ? [{ label: 'Remove password', icon: 'lucide-lock-open', onClick: () => void props.state.setPassword(props.row, null) }]
          : []),
      ],
    },
    {
      group: 'Expiry',
      hideLabel: true,
      options: [
        { label: grant.expires_on ? 'Change expiry' : 'Set expiry', icon: 'lucide-calendar', onClick: () => edit('expiry') },
        ...(grant.expires_on
          ? [{ label: 'Remove expiry', icon: 'lucide-calendar-x', onClick: () => void props.state.setExpiry(props.row, null) }]
          : []),
      ],
    },
    {
      group: 'Link',
      hideLabel: true,
      options: [
        { label: 'Get new URL', icon: 'lucide-refresh-cw', onClick: () => void rotate() },
        { label: 'Delete link', icon: 'lucide-trash-2', theme: 'red', onClick: () => void props.state.remove(props.row) },
      ],
    },
  ]
})

function edit(mode: 'password' | 'expiry') {
  password.value = ''
  day.value = stampDay(props.row.grant.expires_on)
  editing.value = mode
}

async function save() {
  if (editing.value === 'password') {
    const typed = password.value
    // The typed password never outlives the save, whether it worked or not.
    password.value = ''
    await props.state.setPassword(props.row, typed)
  } else {
    await props.state.setExpiry(props.row, day.value)
  }
  if (!props.state.errors.get(principal.value)) close()
}

/** Closes the editor and drops what was typed in it. */
function close() {
  password.value = ''
  editing.value = null
}

async function rotate() {
  const confirmed = await confirm({
    title: 'Get a new URL?',
    message: 'The old URL stops working.',
    confirmLabel: 'Get new URL',
  })
  if (!confirmed) return
  const url = await props.state.rotate(props.row)
  if (url) await copyLink(url, 'New link copied')
}
</script>
