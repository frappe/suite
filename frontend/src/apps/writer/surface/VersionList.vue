<script setup lang="ts">
import { Dropdown, TextInput, Tooltip, type DropdownOptions } from 'frappe-ui'
import { computed, nextTick, ref } from 'vue'

import type { DocumentVersion } from '@/apps/drive'
import { fullName } from '@/apps/writer/composables/useUsers'

import { waitForFocusBack } from './focusBack'
import { versionDays, versionTime } from './versionDates'

/**
 * The document's versions under the day each was taken, newest first, with
 * "Current version" at the top. The row being viewed carries a bar on its left
 * edge; it and a hovered row show Restore and the row's menu.
 */
const props = defineProps<{
  versions: DocumentVersion[]
  canRestore: boolean
  isRestoring: boolean
  canSaveVersion: boolean
  /** Names the version, answering whether Drive took the name; absent for someone who can't. */
  rename?: (version: DocumentVersion, label: string) => Promise<boolean>
}>()

const previewed = defineModel<DocumentVersion | null>('previewed', { required: true })
const emit = defineEmits<{
  restore: [version: DocumentVersion]
  download: [version: DocumentVersion]
  saveVersion: []
}>()

const days = computed(() => versionDays(props.versions))
const isCurrentViewed = computed(() => !previewed.value)
const currentRowClass = computed(() =>
  isCurrentViewed.value ? 'bg-surface-elevation-3 shadow-sm' : 'hover:bg-surface-gray-2',
)
const currentActionsClass = computed(() =>
  isCurrentViewed.value ? '' : 'invisible group-hover:visible group-focus-within:visible',
)
/** The row whose menu is open keeps its actions while the pointer is in the menu. */
const menuRow = ref<number | null>(null)
const renamingRow = ref<number | null>(null)
const newName = ref('')
const isSavingName = ref(false)
const renameInputs = ref<{ focus(): void }[]>([])
// The closing menu hands focus back to its button, which passes it on to the name box once
const focusBack = waitForFocusBack()

function isViewed(version: DocumentVersion) {
  return previewed.value?.seq === version.seq
}

function versionRowClass(version: DocumentVersion) {
  return isViewed(version) ? 'bg-surface-elevation-3 shadow-sm' : 'hover:bg-surface-gray-2'
}

function view(version: DocumentVersion | null) {
  previewed.value = version
}

function actionsClass(version: DocumentVersion) {
  if (isViewed(version) || menuRow.value === version.seq) {
    return ''
  }

  return 'invisible group-hover:visible group-focus-within:visible'
}

// An automatic version goes by its time, in grey, and names only who took it below
function titleClass(version: DocumentVersion) {
  return version.label ? 'text-ink-gray-8' : 'text-ink-gray-6'
}

function title(version: DocumentVersion) {
  return version.label || versionTime(version)
}

function byline(version: DocumentVersion) {
  const person = version.actor && fullName(version.actor)
  const time = version.label && versionTime(version)
  return [person, time].filter(Boolean).join(' · ')
}

function noteMenu(version: DocumentVersion, isOpen: boolean) {
  if (isOpen) {
    menuRow.value = version.seq
  } else if (menuRow.value === version.seq) {
    menuRow.value = null
  }
}

function isRenaming(version: DocumentVersion) {
  return renamingRow.value === version.seq
}

function canRename(version: DocumentVersion) {
  return !!props.rename && (version.kind === 'auto' || version.kind === 'named')
}

async function focusNameBox() {
  await nextTick()
  renameInputs.value[0]?.focus()
}

function startRenaming(version: DocumentVersion) {
  renamingRow.value = version.seq
  newName.value = version.label ?? ''
  focusBack.wait(() => void focusNameBox())
  void focusNameBox()
}

function stopRenaming() {
  renamingRow.value = null
  newName.value = ''
}

function passFocusToNameBox() {
  focusBack.focused()
}

// An empty or unchanged name sends nothing
async function saveName(version: DocumentVersion) {
  const label = newName.value.trim()
  if (!label || label === version.label || !props.rename) {
    stopRenaming()
    return
  }

  isSavingName.value = true
  let isRenamed = false
  try {
    isRenamed = await props.rename(version, label)
  } finally {
    isSavingName.value = false
  }

  if (isRenamed) {
    stopRenaming()
    return
  }

  // The box was disabled while saving, which drops its focus
  await focusNameBox()
}

function actions(version: DocumentVersion): DropdownOptions {
  const download = {
    label: 'Download',
    icon: 'lucide-download',
    onClick: () => emit('download', version),
  }
  if (!canRename(version)) {
    return [download]
  }

  return [
    { label: 'Rename', icon: 'lucide-pencil', onClick: () => startRenaming(version) },
    download,
  ]
}
</script>

<template>
  <div class="space-y-1">
    <div class="group flex items-center rounded-4" :class="currentRowClass">
      <button
        type="button"
        class="min-w-0 flex-1 py-2 pl-3 pr-2 text-left text-sm text-ink-gray-8"
        :aria-pressed="isCurrentViewed"
        @click="view(null)"
      >
        Current version
      </button>
      <div
        v-if="canSaveVersion"
        class="flex shrink-0 items-center pr-1.5"
        :class="currentActionsClass"
      >
        <Tooltip text="Save version">
          <button
            type="button"
            class="flex size-7 items-center justify-center text-ink-gray-5 hover:text-ink-gray-8"
            aria-label="Save version"
            @click="emit('saveVersion')"
          >
            <span class="lucide-bookmark size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
    <section v-for="day in days" :key="day.label">
      <h3 v-if="day.label" class="px-3 pb-1 pt-2 text-sm text-ink-gray-5">{{ day.label }}</h3>
      <div class="space-y-1">
        <div
          v-for="version in day.versions"
          :key="version.seq"
          class="group flex items-center rounded-4"
          :class="versionRowClass(version)"
        >
          <div v-if="isRenaming(version)" class="min-w-0 flex-1 space-y-1 py-1.5 pl-3 pr-1">
            <TextInput
              ref="renameInputs"
              v-model="newName"
              placeholder="Version name"
              aria-label="New version name"
              :disabled="isSavingName"
              @keydown.enter.prevent="saveName(version)"
              @keydown.esc.prevent="stopRenaming"
            />
            <p class="text-p-xs text-ink-gray-5">Enter to save · Esc to cancel</p>
          </div>
          <button
            v-else
            type="button"
            class="min-w-0 flex-1 py-1.5 pl-3 pr-1 text-left"
            :aria-pressed="isViewed(version)"
            @click="view(version)"
          >
            <p class="truncate text-sm" :class="titleClass(version)">{{ title(version) }}</p>
            <p class="truncate text-xs text-ink-gray-5">{{ byline(version) }}</p>
          </button>
          <div class="flex shrink-0 items-center pr-1.5" :class="actionsClass(version)">
            <Tooltip v-if="canRestore" text="Restore this version">
              <button
                type="button"
                class="flex size-7 items-center justify-center text-ink-gray-5 hover:text-ink-gray-8 disabled:opacity-50"
                aria-label="Restore this version"
                :disabled="isRestoring"
                @click="emit('restore', version)"
              >
                <span class="lucide-undo-2 size-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Dropdown
              :options="actions(version)"
              align="end"
              @update:open="noteMenu(version, $event)"
            >
              <button
                type="button"
                class="flex size-7 items-center justify-center text-ink-gray-5 hover:text-ink-gray-8"
                aria-label="More version actions"
                @focus="passFocusToNameBox"
              >
                <span class="lucide-ellipsis size-4" aria-hidden="true" />
              </button>
            </Dropdown>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
