<template>
  <div class="space-y-3">
    <div class="flex items-start gap-2">
      <Combobox
        ref="combobox"
        :model-value="null"
        v-model:query="query"
        class="min-w-0 flex-1"
        :options="options"
        :loading="loading"
        :filterable="false"
        :disabled="disabled"
        placeholder="Add people"
        empty-text="No people or groups found"
        aria-label="Add people, groups or emails"
        @update:query="onQuery"
        @update:open="onOpen"
        @update:model-value="pick"
      />
      <Select v-model="role" class="w-28 shrink-0" :options="roleOptions" aria-label="Role for people you add" />
    </div>

    <!-- People picked wait here, so Notify can be chosen before anyone is added (§7.8). -->
    <div v-if="staged.length" class="space-y-3">
      <ul class="flex flex-wrap gap-1.5" aria-label="People to add">
        <li
          v-for="person in staged"
          :key="person.principal"
          class="flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full bg-surface-gray-2 pl-2.5 pr-0.5 text-sm text-ink-gray-8"
        >
          <span :class="[person.kind === 'group' ? 'lucide-users' : 'lucide-user', 'size-3.5 shrink-0 text-ink-gray-5']" aria-hidden="true" />
          <span class="truncate">{{ person.label }}</span>
          <Button
            icon="lucide-x"
            variant="ghost"
            size="xs"
            class="shrink-0 rounded-full"
            :aria-label="`Don't add ${person.label}`"
            :disabled="disabled"
            @click="unstage(person.principal)"
          />
        </li>
      </ul>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <Checkbox v-if="staged.some((person) => person.kind === 'user')" v-model="notify" class="mr-auto" label="Notify by email" size="sm" />
        <Button label="Cancel" :disabled="disabled" @click="staged = []" />
        <Button variant="solid" label="Share" :loading="disabled" @click="submit" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { Button, Checkbox, Combobox, Select } from 'frappe-ui'
import { useDebounceFn } from '@vueuse/core'

import { groupPrincipal, rolesFor } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { transport } from '@/platform/transport'
import { api as suiteApi, type PeopleGetOutput } from '@/platform/transport/generated'

import type { PickedPerson } from './shareModel'

type Person = PeopleGetOutput['rows'][number]

/** The people picker: users and groups from `GET /api/suite/people`, or any email (unified spec §7.8). */
const props = defineProps<{
  nodeKind: string
  disabled?: boolean
  /** Focus the search field once it shows. */
  autofocus?: boolean
  /** Adds everyone picked. Resolves with those it could not add, who stay picked. */
  share: (people: PickedPerson[], role: number, notify: boolean) => Promise<PickedPerson[]>
}>()
const emit = defineEmits<{ sendLink: [email: string, role: number] }>()
/** Whether anyone waits to be added, so the dialog can step its own actions back. */
const picking = defineModel<boolean>('picking', { default: false })

const combobox = useTemplateRef<{ focus: (options?: FocusOptions) => void }>('combobox')
const query = ref('')
const rows = ref<Person[]>([])
const loading = ref(false)
const role = ref<number>(DRIVE_ROLES.read)
// Notify is on by default for people added (§7.8).
const notify = ref(true)
const staged = ref<PickedPerson[]>([])
watch(
  () => staged.value.length > 0,
  (pending) => (picking.value = pending),
)
onUnmounted(() => (picking.value = false))

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
    // A root holds no links (Drive spec §4.9).
    condition: ({ query: typed }: { query: string }) =>
      props.nodeKind !== 'root' &&
      EMAIL.test(typed.trim()) && !rows.value.some((person) => person.kind === 'user' && person.email === typed.trim()),
    onClick: ({ query: typed }: { query: string }) => {
      emit('sendLink', typed.trim(), role.value)
      query.value = ''
    },
  },
])

onMounted(() => {
  if (props.autofocus) combobox.value?.focus()
})

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
  const picked: PickedPerson =
    kind === 'user'
      ? { principal: id, kind: 'user', label: person?.kind === 'user' ? person.full_name || id : id, name: person?.kind === 'user' ? person.full_name : null }
      : { principal: groupPrincipal(id), kind: 'group', label: id, name: null }
  if (!staged.value.some((entry) => entry.principal === picked.principal)) staged.value = [...staged.value, picked]
  // The input shows the picked label first; clear it once the pick settles.
  void nextTick(() => (query.value = ''))
}

function unstage(principal: string) {
  staged.value = staged.value.filter((person) => person.principal !== principal)
}

async function submit() {
  staged.value = await props.share(staged.value, role.value, notify.value)
  // Once everyone is added the Share button goes away, so focus returns to the people field.
  combobox.value?.focus()
}
</script>
