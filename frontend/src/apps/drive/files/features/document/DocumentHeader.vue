<template>
  <header
    class="relative flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 bg-surface-base px-3 pt-px"
    :data-save-state="saveState"
  >
    <!-- A centered title lifts the title group into the header, between two
      sides that grow alike; the icon and the way back stay at the start. -->
    <div class="flex min-w-0 flex-1 items-center gap-1" :class="centering.title">
      <div class="contents" :class="centering.start">
        <Button
          v-if="shownLocation"
          variant="ghost"
          icon="lucide-chevron-left"
          :route="shownLocation.to"
          :tooltip="`Back to ${shownLocation.label}`"
          :aria-label="`Back to ${shownLocation.label}`"
        />
        <slot name="icon" :icon="typeIcon">
          <span class="size-4.5 shrink-0" :class="typeIcon" aria-hidden="true" />
        </slot>
      </div>
      <!-- The hidden copy of the title gives the field its width, so the field
        fits its text and a refusal sits right after it. -->
      <div class="document-title relative min-w-0 max-w-md">
        <span
          class="invisible block h-7 overflow-hidden whitespace-pre ps-2 pe-2.5 text-base font-medium"
          aria-hidden="true"
          >{{ titleDraft || ' ' }}</span
        >
        <TextInput
          ref="titleInput"
          v-model="titleDraft"
          class="!absolute inset-0"
          variant="ghost"
          :readonly="!renamable"
          :aria-label="titleLabel"
          :title="session.title.value"
          :aria-invalid="titleError ? true : undefined"
          @pointerdown="noteTitlePress"
          @click="selectTitleOnClick"
          @blur="renameOnBlur"
          @keydown.stop
          @keydown.enter.prevent="renameOnEnter"
          @keydown.escape.prevent="revertTitle"
        />
      </div>
      <span
        v-if="titleError"
        class="title-refusal ms-1 min-w-0 max-w-64 truncate text-sm text-ink-red-7"
        role="alert"
        :title="titleError"
      >
        {{ titleError }}
      </span>
      <Badge
        v-if="badge"
        :label="badge.label"
        :theme="badge.theme"
        variant="subtle"
        class="shrink-0"
      >
        <template v-if="badge.icon" #prefix>
          <span class="size-2.5" :class="badge.icon" aria-hidden="true" />
        </template>
      </Badge>
      <template v-if="recoverable">
        <Button
          class="shrink-0 max-md:hidden"
          variant="ghost"
          icon-left="lucide-download"
          label="Download my changes"
          @click="emit('downloadChanges')"
        />
        <Button
          class="md:hidden"
          variant="ghost"
          icon="lucide-download"
          tooltip="Download my changes"
          aria-label="Download my changes"
          @click="emit('downloadChanges')"
        />
      </template>
      <slot name="status" />
    </div>

    <div class="flex shrink-0 items-center gap-1" :class="centering.end">
      <DocumentEditedNote v-if="shownNote" class="mr-1" v-bind="note" />
      <slot name="actions" />
      <!-- Share shows its icon and the word from `md` up, and the icon alone below it. -->
      <template v-if="session.canShare.value">
        <Button
          class="max-md:hidden"
          variant="ghost"
          icon-left="lucide-share-2"
          label="Share"
          @click="session.share()"
        />
        <Button
          class="md:hidden"
          variant="ghost"
          icon="lucide-share-2"
          tooltip="Share"
          aria-label="Share"
          @click="session.share()"
        />
      </template>
      <slot name="menu">
        <Dropdown :options="ownMenu" align="end">
          <Button
            variant="ghost"
            icon="lucide-ellipsis"
            :tooltip="__('More actions')"
            :aria-label="__('More actions')"
          />
        </Dropdown>
      </slot>
      <div v-if="$slots.primary" class="ml-1 flex">
        <slot name="primary" />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useNow, useOnline } from '@vueuse/core'
import { Badge, Button, Dropdown, TextInput } from 'frappe-ui'
import { computed, ref, shallowRef, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import { driveNodeRoute } from '@/apps/drive'
import type { DocumentSession } from '@/apps/drive/client/session'
import { selectStem } from '@/apps/drive/files/internal/filename'
import { useLocationTitle } from '@/apps/drive/files/internal/locations'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

import { canRename } from '../nodeActions'
import DocumentEditedNote from './DocumentEditedNote.vue'
import { editedDetails, editedLabel } from './editedLabel'
import { copyLinkAction, documentTypeIcon, starAction, type DocumentSaveState } from './header'

/**
 * The one header every document surface shows: the Drive type icon, the title
 * (renamed in place), state badges, the recovery download, when it was last edited, the surface's
 * own actions, Share, the surface's menu, then its primary action, always in that
 * order.
 */
const props = withDefaults(
  defineProps<{
    session: DocumentSession
    /** The title field's accessible name, such as "Spreadsheet title". */
    titleLabel: string
    /** Omitted for content that has no save state, such as a file preview. */
    saveState?: DocumentSaveState | null
    /** Why saving is held up. Says so in place of when the document was edited. */
    saveNote?: string
    /** The content cannot be edited here. A trashed document says Trashed instead. */
    viewOnly?: boolean
    /** A copy of edits that could not be saved is kept on this device. */
    recoverable?: boolean
    /** The surface's own state, such as "Locked". It shows in place of View only. */
    stateBadge?: string
    /**
     * The folder the back arrow leads to. Left out, it is the document's own
     * folder; `null` shows no arrow.
     */
    location?: { label: string; to: RouteLocationRaw } | null
    /** A file's MIME type picks its icon. Documents have none. */
    mime?: string | null
    /** `centered` centers the title across the header on wide screens. */
    layout?: 'default' | 'centered'
  }>(),
  {
    saveState: null,
    saveNote: '',
    viewOnly: false,
    recoverable: false,
    stateBadge: '',
    mime: null,
    layout: 'default',
  },
)

const emit = defineEmits<{ downloadChanges: [] }>()

const online = useOnline()
const titleInput = ref<InstanceType<typeof TextInput> | null>(null)
const titleDraft = ref(props.session.title.value)
/** A centered title sits between two sides that grow alike. */
const CENTERED = {
  title: 'md:contents',
  start: 'md:flex md:flex-1 md:items-center md:gap-1',
  end: 'md:flex-1 md:justify-end',
}
const UNCENTERED = { title: '', start: '', end: '' }
// Starts from the server, then follows this tab's edits. Someone else's show at the next open.
const editedHere = shallowRef<Date | null>(null)
watch(
  () => props.saveState,
  (state) => {
    if (state === 'saving' || state === 'unsaved') editedHere.value = new Date()
  },
)
const now = useNow({ interval: 60_000 })
// A failed save is a badge, and content with no save state, such as a file preview, says nothing.
const edited = computed(() => {
  if (!props.saveState || props.saveState === 'failed') return null
  const stored = props.session.editedAt
  return editedHere.value ?? (stored ? new Date(stored) : null)
})
const editedNote = computed(() => (edited.value ? editedLabel(edited.value, now.value) : ''))
const shownNote = computed(() => props.saveNote || editedNote.value)
// A note about saving says all it has to; only the time edited has more behind it
const noteDetails = computed(() => {
  if (props.saveNote || !edited.value) return []
  const { createdAt, createdBy } = props.session
  return editedDetails(edited.value, createdAt ? new Date(createdAt) : null, createdBy)
})
// A note about saving shows on every width and is announced; the time edited shows on wide screens only
const note = computed(() => ({
  class: [
    // Half a pixel down puts the smaller text on the title's baseline
    'relative top-[0.5px] whitespace-nowrap text-sm text-ink-gray-5',
    props.saveNote ? '' : 'max-md:hidden',
  ],
  'aria-live': props.saveNote ? 'polite' : 'off',
  text: shownNote.value,
  details: noteDetails.value,
}))
const centering = computed(() => (props.layout === 'centered' ? CENTERED : UNCENTERED))
const trashed = computed(() => props.session.state.value === 'Trashed')
// One badge at most: the first state that holds, in this order
const badge = computed(() => {
  if (trashed.value) return { label: 'Trashed', theme: 'red', icon: 'lucide-trash-2' } as const
  if (props.saveState === 'failed') return { label: __('Not saved'), theme: 'amber' } as const
  if (!online.value) return { label: 'Offline', theme: 'amber' } as const
  if (props.stateBadge) return { label: props.stateBadge, theme: 'gray' } as const
  if (props.viewOnly) return { label: 'View only', theme: 'gray' } as const
  return null
})
// A surface with no menu of its own still offers Copy link and Star
const ownMenu = computed(() => [copyLinkAction(), ...starAction(props.session)])
const account = useSession()
const locationTitle = useLocationTitle()
// With no folder to read a signed-in person goes back to Drive, and a guest has no way back
const shownLocation = computed(() => {
  if (props.location !== undefined) return props.location
  const folder = props.session.folder.value
  if (folder) {
    const label = locationTitle(folder)
    return { label, to: driveNodeRoute(folder.name, label, 'folder') }
  }
  return account.status.value === 'authenticated'
    ? { label: 'Drive', to: { path: '/drive' } }
    : null
})
const renamable = computed(() =>
  canRename({ state: props.session.state.value, access: props.session.access.value }),
)
const typeIcon = computed(() =>
  documentTypeIcon(props.session.contentDoctype, props.session.title.value, props.mime),
)

/** A refused rename, shown beside the title until the title changes. */
const titleError = ref<string>()

watch(
  () => props.session.title.value,
  (title) => {
    titleDraft.value = title
  },
)
watch(
  titleDraft,
  () => {
    titleError.value = undefined
  },
  { flush: 'sync' },
)

function blurTitle() {
  titleInput.value?.inputElement?.blur()
}

function revertTitle() {
  titleDraft.value = props.session.title.value
  blurTitle()
}

/** Selects a file's name up to its extension, or a document's whole title. */
function selectTitle(input: HTMLInputElement) {
  if (props.session.contentDoctype === 'File') selectStem(input)
  else input.select()
}

/** The press that is focusing the title, as opposed to one inside a focused title. */
let focusingPress = false

function noteTitlePress(event: PointerEvent) {
  focusingPress = renamable.value && document.activeElement !== event.currentTarget
}

/**
 * A click into the title selects all of it, extension included. A drag that
 * selected part of the title keeps that selection.
 */
function selectTitleOnClick(event: MouseEvent) {
  const input = event.currentTarget
  if (!focusingPress || !(input instanceof HTMLInputElement)) return
  focusingPress = false
  if (input.selectionStart === input.selectionEnd) input.select()
}

/** Saves the draft title and returns the refusal message, or null. */
async function rename(): Promise<string | null> {
  const title = titleDraft.value.trim()
  if (!title || title === props.session.title.value || !renamable.value) {
    titleDraft.value = props.session.title.value
    return null
  }
  try {
    await props.session.rename(title)
    return null
  } catch (error) {
    if (!(error instanceof TransportError)) {
      return error instanceof Error ? error.message : __('Could not rename this file.')
    }
    // Drive names a free title only when the title is taken, so the message
    // can offer it.
    const free = error.details.free_title
    if (error.type === 'DriveConflict' && typeof free === 'string') {
      return __('That name is taken in this folder. Try “{0}”.', [free])
    }
    // Offline or a server failure: the message is the browser's or the server's, not ours.
    if (error.status === 0 || error.status >= 500)
      return __('Could not rename this file. Try again.')
    return error.message
  }
}

/** Enter keeps the field focused on a refusal, so the name can be corrected. */
async function renameOnEnter() {
  const refusal = await rename()
  const input = titleInput.value?.inputElement
  if (!refusal || !input) return blurTitle()
  titleError.value = refusal
  selectTitle(input)
}

/** Leaving the field restores the saved title on a refusal and says why. */
async function renameOnBlur() {
  const refusal = await rename()
  if (!refusal) return
  titleDraft.value = props.session.title.value
  titleError.value = refusal
}

defineExpose({
  /**
   * Puts the caret in the title with the name selected, for a Rename menu
   * item. A closing menu hands focus back to its trigger a moment later, so the
   * title takes it back once if that happens straight away.
   */
  focusTitle() {
    const input = titleInput.value?.inputElement
    if (!input) return
    const take = () => {
      input.focus()
      selectTitle(input)
    }
    take()
    document.addEventListener('focusin', take, { once: true })
    setTimeout(() => document.removeEventListener('focusin', take), 250)
  },
})
</script>

<style scoped>
/*
 * The title reads as a heading. An editable title shows an outline on hover,
 * and a stronger one while it is being edited.
 */
.document-title :deep([data-slot='control']) {
  font-weight: 500;
  text-overflow: ellipsis;
}
.document-title :deep([data-slot='control']:not([readonly]):hover) {
  box-shadow: inset 0 0 0 1px var(--outline-gray-2);
}
.document-title :deep([data-slot='control']:not([readonly]):focus) {
  box-shadow: inset 0 0 0 1px var(--outline-gray-4);
}
.document-title :deep([data-slot='control'][readonly]) {
  background: transparent;
  cursor: default;
}

/*
 * A refusal sits beside the title, cut short with the whole message on hover.
 * A phone has no room beside the title and a touch screen has no hover, so
 * there the whole message shows in a callout under the header.
 */
@media (max-width: 767px), (pointer: coarse) {
  .title-refusal {
    @apply absolute inset-x-3 top-[calc(100%+0.25rem)] z-10 m-0 max-w-none overflow-visible whitespace-normal rounded-4 border border-outline-elevation-2 bg-surface-elevation-2 px-3 py-2 shadow-2xl;
  }
}
</style>
