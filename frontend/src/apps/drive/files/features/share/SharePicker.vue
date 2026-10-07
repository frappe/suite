<template>
  <div class="space-y-3">
    <div class="flex items-start gap-2">
      <Combobox
        ref="combobox"
        v-model:query="query"
        :model-value="null"
        class="min-w-0 flex-1"
        size="sm"
        variant="outline"
        :options="options"
        :loading="loading && !rows.length"
        :filterable="false"
        :disabled="disabled"
        :placeholder="__('Add people or groups')"
        :empty-text="__('No people or groups found')"
        :aria-label="__('Add people, groups or emails')"
        @update:open="onOpen"
      />
      <Select
        v-if="staged.length"
        v-model="role"
        size="sm"
        variant="outline"
        :disabled="disabled"
        class="w-28 shrink-0"
        :options="roleOptions"
        :aria-label="__('Access for people you add')"
      />
    </div>

    <!-- People picked wait here, so Notify can be chosen before anyone is added (§7.8). -->
    <div v-if="staged.length" class="space-y-3">
      <ul :aria-label="__('People to add')">
        <li
          v-for="person in staged"
          :key="person.principal"
          class="relative flex h-[60px] items-center gap-3 before:absolute before:left-11 before:right-0 before:top-0 before:border-t before:border-outline-gray-1 first:before:border-0"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
            aria-hidden="true"
          >
            <span :class="[person.kind === 'group' ? 'lucide-users' : 'lucide-user', 'size-4']" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-p-base-medium">{{ person.label }}</p>
            <p
              v-if="person.kind === 'user' && person.label !== person.principal"
              class="mt-0.5 truncate text-p-sm text-ink-gray-5"
            >
              {{ person.principal }}
            </p>
          </div>
          <Button
            icon="lucide-x"
            variant="ghost"
            size="sm"
            class="shrink-0"
            :aria-label="__('Remove {0}', [person.label])"
            :disabled="disabled"
            @click="unstage(person.principal)"
          />
        </li>
      </ul>
      <div
        class="flex flex-wrap items-center justify-end gap-2 border-t border-outline-gray-1 pt-4"
      >
        <Checkbox
          v-if="staged.some((person) => person.kind === 'user')"
          v-model="notify"
          class="mr-auto"
          :label="__('Notify by email')"
          size="sm"
        />
        <Button :label="__('Cancel')" :disabled="disabled" @click="cancel" />
        <Button variant="solid" :label="__('Share')" :loading="disabled" @click="submit" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { Button, Checkbox, Combobox, Select } from 'frappe-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import { api, client } from '@/api'
import { groupPrincipal, rolesFor } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'
import type { PeopleGetOutput } from '@/platform/transport/generated'

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
let request = 0
watch(
  () => staged.value.length > 0,
  (pending) => (picking.value = pending),
)
onUnmounted(() => {
  request += 1
  picking.value = false
})

const roleOptions = computed(() =>
  rolesFor('user', props.nodeKind).map((option) => ({
    label: __(option.label),
    value: option.value,
  })),
)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const options = computed(() => [
  ...rows.value
    .filter(
      (person) =>
        !staged.value.some(
          (entry) =>
            entry.principal ===
            (person.kind === 'user' ? person.email : groupPrincipal(person.name)),
        ),
    )
    .map((person) => ({
      type: 'custom' as const,
      key: person.kind === 'user' ? `user:${person.email}` : `group:${person.name}`,
      label: person.kind === 'user' ? person.full_name || person.email : person.name,
      description:
        person.kind === 'user'
          ? person.email
          : person.member_count === 1
            ? __('1 member')
            : __('{0} members', [person.member_count]),
      icon: person.kind === 'user' ? 'lucide-user' : 'lucide-users',
      keepOpen: true,
      onClick: () => pick(person.kind === 'user' ? `user:${person.email}` : `group:${person.name}`),
    })),
  {
    type: 'custom' as const,
    key: 'send-link',
    label: __('Send a link to {0}', [query.value.trim()]),
    icon: 'lucide-mail',
    // A share link gives at most Edit (Drive spec §5.9).
    disabled: role.value > DRIVE_ROLES.edit,
    description: role.value > DRIVE_ROLES.edit ? __('A link gives at most Edit') : undefined,
    // A root holds no links (Drive spec §4.9).
    condition: ({ query: typed }: { query: string }) =>
      props.nodeKind !== 'root' &&
      EMAIL.test(typed.trim()) &&
      !rows.value.some((person) => person.kind === 'user' && person.email === typed.trim()),
    onClick: ({ query: typed }: { query: string }) => {
      emit('sendLink', typed.trim(), role.value)
      query.value = ''
    },
  },
])

onMounted(() => {
  if (props.autofocus) combobox.value?.focus()
})

async function search(text: string, id: number) {
  if (id !== request) return
  loading.value = true
  try {
    const page = await client.query(api.suite.people.list, text ? { q: text } : {})
    if (id === request) rows.value = page.rows
  } catch {
    if (id === request) rows.value = []
  } finally {
    if (id === request) loading.value = false
  }
}

const searchLater = useDebounceFn((text: string, id: number) => void search(text, id), 250)
// Invalidate in-flight results as soon as the query changes, before the debounce.
watch(
  () => query.value.trim(),
  (text) => {
    loading.value = true
    void searchLater(text, ++request)
  },
  { flush: 'sync' },
)

function onOpen(open: boolean) {
  if (open && !rows.value.length && !loading.value) void search(query.value.trim(), ++request)
}

function pick(value: string | number | null | undefined) {
  if (typeof value !== 'string') return
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':')
  const person = rows.value.find((row) => (row.kind === 'user' ? row.email : row.name) === id)
  const picked: PickedPerson =
    kind === 'user'
      ? {
          principal: id,
          kind: 'user',
          label: person?.kind === 'user' ? person.full_name || id : id,
          name: person?.kind === 'user' ? person.full_name : null,
        }
      : { principal: groupPrincipal(id), kind: 'group', label: id, name: null }
  if (!staged.value.some((entry) => entry.principal === picked.principal))
    staged.value = [...staged.value, picked]
  // Pointer selection moves focus to the option; return it to the open search.
  void nextTick(() => {
    query.value = ''
    combobox.value?.focus()
  })
}

function unstage(principal: string) {
  staged.value = staged.value.filter((person) => person.principal !== principal)
  if (!staged.value.length) void nextTick(() => combobox.value?.focus())
}

function cancel() {
  staged.value = []
  void nextTick(() => combobox.value?.focus())
}

async function submit() {
  staged.value = await props.share(staged.value, role.value, notify.value)
  // Once everyone is added the Share button goes away, so focus returns to the people field.
  combobox.value?.focus()
}
</script>
