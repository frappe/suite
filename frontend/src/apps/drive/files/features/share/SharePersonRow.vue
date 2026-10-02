<template>
  <li>
    <div class="flex min-h-12 items-center gap-3" :class="{ 'opacity-60': row.expired }">
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
        aria-hidden="true"
      >
        <span :class="[row.kind === 'group' ? 'lucide-users' : 'lucide-user', 'size-4']" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate">{{ state.label(row.grant.principal) }}</p>
        <p v-if="meta" class="mt-1 truncate text-sm text-ink-gray-5">{{ meta }}</p>
      </div>
      <Button v-if="row.denied" label="Allow again" :loading="busy" @click="state.allowAgain(row)" />
      <Dropdown v-else :options="options" align="end">
        <Button
          :aria-label="`Access for ${state.label(principal)}: ${value}`"
          icon-right="lucide-chevron-down"
          variant="ghost"
          class="shrink-0"
          :loading="busy"
        >
          {{ value }}
        </Button>
      </Dropdown>
    </div>

    <form v-if="editing" class="flex items-center gap-2 pb-3 pl-10" @submit.prevent="save">
      <DatePicker v-model="day" class="min-w-0 flex-1" placeholder="Expiry date" aria-label="Access expiry date" />
      <Button type="submit" variant="solid" label="Save" :loading="busy" :disabled="!day" />
      <Button label="Cancel" @click="editing = false" />
    </form>
    <ErrorMessage v-if="error" class="pb-2" :message="error" />
  </li>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, DatePicker, Dropdown, ErrorMessage, type DropdownItem, type DropdownOption } from 'frappe-ui'

import { roleLabel, rolesFor } from '@/apps/drive/client/grants'

import type { LocalRow } from './shareModel'
import { formatDay, stampDay } from './shareFormat'
import type { ShareState } from './useShare'

/** One person or group row: role, expiry and removal (unified spec §7.4, §7.9). */
const props = defineProps<{ row: LocalRow; state: ShareState; nodeKind: string }>()

const editing = ref(false)
const day = ref('')

const principal = computed(() => props.row.grant.principal)
const busy = computed(() => props.state.isPending(principal.value))
const error = computed(() => props.state.errors.get(principal.value))

const value = computed(() => (props.row.expired ? 'Expired' : roleLabel(props.row.grant.role)))

const meta = computed(() => {
  const { row } = props
  if (row.expired && row.grant.expires_on) return `Expired ${formatDay(row.grant.expires_on)}`
  if (row.denied) return 'Denied here'
  const parts = [row.kind === 'group' ? 'Group' : '']
  if (row.grant.expires_on) parts.push(`Until ${formatDay(row.grant.expires_on)}`)
  return parts.filter(Boolean).join(' · ')
})

const options = computed<DropdownItem[]>(() => {
  const { row, state, nodeKind } = props
  const holdsItems = nodeKind === 'folder' || nodeKind === 'root'
  const removal: DropdownOption[] = [
    { label: 'Remove', icon: 'lucide-x', theme: 'red', onClick: () => void state.remove(row) },
    ...(holdsItems
      ? [{ label: 'Remove here and inside', icon: 'lucide-folder-x', theme: 'red' as const, onClick: () => void state.remove(row, true) }]
      : []),
  ]
  if (row.expired) return removal
  return [
    {
      group: 'Access',
      hideLabel: true,
      options: rolesFor(row.kind, nodeKind).map((role) => ({
        label: role.label,
        selected: role.value === row.grant.role,
        onClick: () => void (role.value !== row.grant.role && state.setRole(row, role.value)),
      })),
    },
    {
      group: 'Expiry',
      hideLabel: true,
      options: [
        { label: row.grant.expires_on ? 'Change expiry' : 'Set expiry', icon: 'lucide-calendar', onClick: edit },
        ...(row.grant.expires_on
          ? [{ label: 'Remove expiry', icon: 'lucide-calendar-x', onClick: () => void state.setExpiry(row, null) }]
          : []),
      ],
    },
    { group: 'Remove', hideLabel: true, options: removal },
  ]
})

function edit() {
  day.value = stampDay(props.row.grant.expires_on)
  editing.value = true
}

async function save() {
  await props.state.setExpiry(props.row, day.value)
  if (!props.state.errors.get(principal.value)) editing.value = false
}
</script>
