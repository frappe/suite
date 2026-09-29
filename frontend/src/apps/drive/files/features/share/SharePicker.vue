<template>
  <div class="space-y-2">
    <div class="flex items-start gap-2">
      <Combobox
        :model-value="null"
        v-model:query="query"
        class="min-w-0 flex-1"
        :options="options"
        :loading="loading"
        :filterable="false"
        :disabled="disabled"
        placeholder="Add people, groups or emails"
        empty-text="No people or groups found"
        aria-label="Add people, groups or emails"
        @update:query="onQuery"
        @update:open="onOpen"
        @update:model-value="pick"
      />
      <Select v-model="role" class="w-28 shrink-0" :options="roleOptions" aria-label="Role for people you add" />
    </div>
    <Checkbox v-model="notify" label="Notify by email" size="sm" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Checkbox, Combobox, Select } from 'frappe-ui'
import { useDebounceFn } from '@vueuse/core'

import { groupPrincipal, rolesFor } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { transport } from '@/platform/transport'
import { api as suiteApi, type PeopleGetOutput } from '@/platform/transport/generated'

type Person = PeopleGetOutput['rows'][number]

/** The people picker: users and groups from `GET /api/suite/people`, or any email (unified spec §7.8). */
const props = defineProps<{ nodeKind: string; disabled?: boolean }>()
const emit = defineEmits<{
  add: [principal: string, role: number, notify: boolean, name: string | null]
  sendLink: [email: string, role: number]
}>()

const query = ref('')
const rows = ref<Person[]>([])
const loading = ref(false)
const role = ref<number>(DRIVE_ROLES.read)
// Notify is on by default for people added (§7.8).
const notify = ref(true)

const roleOptions = computed(() => rolesFor('user', props.nodeKind).map((option) => ({ label: option.label, value: option.value })))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const options = computed(() => [
  ...rows.value.map((person) =>
    person.kind === 'user'
      ? { label: person.full_name || person.email, value: `user:${person.email}`, description: person.email, icon: 'lucide-user' }
      : {
          label: person.name,
          value: `group:${person.name}`,
          description: `${person.member_count} ${person.member_count === 1 ? 'member' : 'members'}`,
          icon: 'lucide-users',
        },
  ),
  {
    type: 'custom' as const,
    key: 'send-link',
    label: `Send a link to ${query.value.trim()}`,
    icon: 'lucide-mail',
    // A share link gives at most Edit (Drive spec §5.9).
    disabled: role.value > DRIVE_ROLES.edit,
    description: role.value > DRIVE_ROLES.edit ? 'A link gives at most Edit' : undefined,
    condition: ({ query: typed }: { query: string }) =>
      EMAIL.test(typed.trim()) && !rows.value.some((person) => person.kind === 'user' && person.email === typed.trim()),
    onClick: ({ query: typed }: { query: string }) => {
      emit('sendLink', typed.trim(), role.value)
      query.value = ''
    },
  },
])

let request = 0
async function search(text: string) {
  const id = ++request
  loading.value = true
  try {
    const page = await transport.request(suiteApi.people_get, text.trim() ? { q: text.trim() } : {})
    if (id === request) rows.value = page.rows
  } catch {
    if (id === request) rows.value = []
  } finally {
    if (id === request) loading.value = false
  }
}

const onQuery = useDebounceFn((text: string) => void search(text), 250)

function onOpen(open: boolean) {
  if (open && !rows.value.length) void search(query.value)
}

function pick(value: string | number | null | undefined) {
  if (typeof value !== 'string') return
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':')
  const person = rows.value.find((row) => (row.kind === 'user' ? row.email : row.name) === id)
  if (kind === 'user') emit('add', id, role.value, notify.value, person?.kind === 'user' ? person.full_name : null)
  else emit('add', groupPrincipal(id), role.value, false, null)
  // The input shows the picked label first; clear it once the pick settles.
  void nextTick(() => (query.value = ''))
}
</script>
