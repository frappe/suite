<!--
  A practice copy of Suite's command menu for the onboarding step that teaches
  it. It looks like "Search Suite" and lists the commands a new workspace has,
  but picking one only reports the pick: nothing is created and the wizard
  stays where it is.
-->
<script setup lang="ts">
import { Dialog, TextInput } from 'frappe-ui'
import { computed, ref, useId, watch } from 'vue'

import AppIconView from './AppIconView.vue'
import { SUITE_APPS, type AppIcon, type SuiteApp } from './suiteApps'

const { admin = false } = defineProps<{ admin?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [label: string] }>()

interface Command {
  label: string
  icon: AppIcon
}

const app = (id: string): SuiteApp | undefined => SUITE_APPS.find((entry) => entry.id === id)
const iconOf = (id: string): AppIcon => app(id)?.icon ?? { className: 'lucide-circle' }

const groups = computed(() =>
  [
    {
      label: __('Create'),
      commands: [
        { label: __('New document'), icon: iconOf('writer') },
        { label: __('New spreadsheet'), icon: iconOf('sheets') },
        { label: __('New presentation'), icon: iconOf('slides') },
      ],
    },
    {
      label: __('Go to'),
      commands: ['drive', 'mail', 'calendar'].map((id) => ({
        label: app(id)?.name() ?? id,
        icon: iconOf(id),
      })),
    },
    ...(admin
      ? [
          {
            label: __('Admin'),
            commands: [{ label: __('Invite people'), icon: { className: 'lucide-user-plus' } }],
          },
        ]
      : []),
  ].flatMap((group) => {
    const text = query.value.trim().toLowerCase()
    const commands = group.commands.filter((command: Command) =>
      command.label.toLowerCase().includes(text),
    )
    return commands.length ? [{ ...group, commands }] : []
  }),
)

const query = ref('')
const active = ref(0)
const flat = computed(() => groups.value.flatMap((group) => group.commands))
const listId = useId()
watch([query, open], () => {
  active.value = 0
})

function move(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') active.value = Math.min(active.value + 1, flat.value.length - 1)
  else if (event.key === 'ArrowUp') active.value = Math.max(active.value - 1, 0)
  else if (event.key === 'Enter' && flat.value[active.value]) pick(flat.value[active.value]!)
  else return
  event.preventDefault()
}

function pick(command: Command) {
  open.value = false
  query.value = ''
  emit('pick', command.label)
}
</script>

<template>
  <Dialog v-model:open="open" bare position="top" :title="__('Search Suite')">
    <div class="flex flex-col" @keydown="move">
      <div class="border-b border-outline-gray-1 p-2">
        <TextInput
          v-model="query"
          variant="ghost"
          size="lg"
          :placeholder="__('Search Suite')"
          :aria-label="__('Search Suite')"
          role="combobox"
          :aria-controls="listId"
          aria-expanded="true"
          :aria-activedescendant="flat.length ? `${listId}-${active}` : undefined"
        >
          <template #prefix>
            <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
          </template>
        </TextInput>
      </div>
      <div :id="listId" class="max-h-80 overflow-auto p-2" role="listbox">
        <div v-for="group in groups" :key="group.label" role="group" :aria-label="group.label">
          <p class="px-2 pt-2 pb-1 text-sm text-ink-gray-5" aria-hidden="true">
            {{ group.label }}
          </p>
          <div
            v-for="command in group.commands"
            :id="`${listId}-${flat.indexOf(command)}`"
            :key="command.label"
            role="option"
            :aria-selected="flat[active] === command"
            class="flex w-full cursor-pointer items-center gap-3 rounded-4 px-2 py-2 text-base text-ink-gray-8"
            :class="flat[active] === command ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2'"
            @mouseenter="active = flat.indexOf(command)"
            @click="pick(command)"
          >
            <AppIconView :icon="command.icon" class="size-4 shrink-0 text-ink-gray-6" />
            {{ command.label }}
          </div>
        </div>
        <p v-if="!flat.length" class="px-2 py-6 text-center text-base text-ink-gray-5">
          {{ __('No results') }}
        </p>
      </div>
    </div>
  </Dialog>
</template>
