<template>
  <div class="flex flex-col gap-3">
    <!-- People picked wait below the field as chips, so the access list stays in view (§7.8). -->
    <Combobox
      ref="combobox"
      v-model:query="query"
      :model-value="null"
      class="w-full"
      size="md"
      :options="options"
      :loading="loading && !rows.length"
      :filterable="false"
      :disabled="disabled"
      :placeholder="fieldLabel"
      :empty-text="__('No people or groups found')"
      :aria-label="fieldLabel"
      @update:open="onOpen"
      @keydown.delete.capture="focusLastChip"
    >
      <template #item-person="{ item }">
        <div class="flex min-w-0 items-center gap-2.5">
          <Avatar
            v-if="item.kind === 'user'"
            size="lg"
            :image="item.image ?? undefined"
            :label="item.label"
          />
          <span
            v-else
            class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
            aria-hidden="true"
          >
            <span :class="[item.kind === 'email' ? 'lucide-mail' : 'lucide-users', 'size-4']" />
          </span>
          <span class="min-w-0">
            <span class="block truncate text-ink-gray-8">{{ item.label }}</span>
            <span class="block truncate text-p-sm text-ink-gray-5">{{ item.description }}</span>
          </span>
        </div>
      </template>
    </Combobox>

    <ul
      v-if="staged.length"
      ref="chips"
      class="flex flex-wrap gap-1.5"
      :aria-label="__('People to add')"
    >
      <li v-for="person in staged" :key="person.principal" class="min-w-0 max-w-full">
        <button
          type="button"
          class="flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-surface-gray-2 pl-2.5 pr-2 text-base text-ink-gray-8 transition-colors hover:bg-surface-gray-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
          :aria-label="__('Remove {0}', [person.label])"
          :title="person.kind === 'user' ? person.principal : undefined"
          :disabled="disabled"
          @click="unstage(person.principal)"
          @keydown.delete.prevent="unstage(person.principal)"
          @keydown.backspace.prevent="unstage(person.principal)"
        >
          <span
            :class="[
              { user: 'lucide-user', group: 'lucide-users', email: 'lucide-mail' }[person.kind],
              'size-4 shrink-0 text-ink-gray-6',
            ]"
            aria-hidden="true"
          />
          <span class="max-w-60 truncate">{{ person.label }}</span>
          <span class="lucide-x size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div v-if="staged.length" class="flex flex-wrap items-center justify-end gap-2">
      <Checkbox
        v-if="staged.some((person) => person.kind === 'user')"
        v-model="notify"
        class="mr-auto"
        :label="__('Notify by email')"
        size="sm"
      />
      <Dropdown :options="roleChoices" align="end">
        <Button
          variant="ghost"
          icon-right="lucide-chevron-down"
          class="shrink-0"
          :disabled="disabled"
          :aria-label="__('Access for people you add: {0}', [__(roleLabel(role))])"
        >
          {{ __(roleLabel(role)) }}
        </Button>
      </Dropdown>
      <Button :label="__('Cancel')" :disabled="disabled" @click="cancel" />
      <Button variant="solid" :label="__('Share')" :loading="disabled" @click="submit" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { Avatar, Button, Checkbox, Combobox, Dropdown } from 'frappe-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import { api, client } from '@/api'
import { groupPrincipal, roleLabel } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'
import type { PeopleGetOutput } from '@/platform/transport/generated'

import { roleMenu } from './shareMenu'
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
/** How many people wait to be added, so the dialog can step its own actions back. */
const picked = defineModel<number>('picked', { default: 0 })

const combobox = useTemplateRef<{ focus: (options?: FocusOptions) => void }>('combobox')
const chips = useTemplateRef<HTMLElement>('chips')
const query = ref('')
const rows = ref<Person[]>([])
const loading = ref(false)
const role = ref<number>(DRIVE_ROLES.read)
// Notify is on by default for people added (§7.8).
const notify = ref(true)
const staged = ref<PickedPerson[]>([])
let request = 0
watch(
  () => staged.value.length,
  (count) => (picked.value = count),
)
onUnmounted(() => {
  request += 1
  picked.value = 0
})

// An outside address gets a share link, which gives at most Edit (Drive spec §5.9).
const inviting = computed(() => staged.value.some((person) => person.kind === 'email'))
const roleChoices = computed(() => [
  roleMenu(
    inviting.value ? 'link' : 'user',
    props.nodeKind,
    role.value,
    (next) => (role.value = next),
  ),
])

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// An email address of someone not listed gets a share link, which a root cannot hold.
const fieldLabel = computed(() =>
  props.nodeKind === 'root' ? __('Add people or groups') : __('Add people, groups or emails'),
)

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
      // Name and email or member count share one line (`#item-person`).
      slot: 'person',
      label: person.kind === 'user' ? person.full_name || person.email : person.name,
      kind: person.kind,
      image: person.kind === 'user' ? person.user_image : null,
      description:
        person.kind === 'user'
          ? person.email
          : person.member_count === 1
            ? __('1 member')
            : __('{0} members', [person.member_count]),
      onClick: () => pick(person.kind === 'user' ? `user:${person.email}` : `group:${person.name}`),
    })),
  // Someone not listed is added as an address; on Share they get a link by email (§7.8).
  {
    type: 'custom' as const,
    key: 'invite',
    slot: 'person',
    kind: 'email',
    label: query.value.trim(),
    // A share link gives at most Edit (Drive spec §5.9).
    disabled: role.value > DRIVE_ROLES.edit,
    description:
      role.value > DRIVE_ROLES.edit
        ? __('A link gives at most Edit')
        : __('Gets a link by email when you share'),
    // A root holds no links (Drive spec §4.9).
    condition: ({ query: typed }: { query: string }) =>
      props.nodeKind !== 'root' &&
      EMAIL.test(typed.trim()) &&
      !rows.value.some((person) => person.kind === 'user' && person.email === typed.trim()),
    onClick: ({ query: typed }: { query: string }) => {
      const email = typed.trim()
      if (!staged.value.some((person) => person.principal === email))
        staged.value = [
          ...staged.value,
          { principal: email, kind: 'email', label: email, name: null },
        ]
      void nextTick(() => {
        query.value = ''
        combobox.value?.focus()
      })
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
  if (!staged.value.some((entry) => entry.principal === picked.principal)) {
    staged.value = [...staged.value, picked]
  }
  // The list closes so the person picked shows; focus returns to the search for the next one.
  void nextTick(() => {
    query.value = ''
    combobox.value?.focus()
  })
}

function unstage(principal: string) {
  staged.value = staged.value.filter((person) => person.principal !== principal)
  void nextTick(() => combobox.value?.focus())
}

/** Backspace in an empty search moves to the last chip, as in Mail; another Backspace removes it. */
function focusLastChip(event: KeyboardEvent) {
  if (query.value || event.key !== 'Backspace') return
  const last = chips.value?.querySelector<HTMLButtonElement>('li:last-child button')
  if (!last) return
  event.preventDefault()
  last.focus()
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
