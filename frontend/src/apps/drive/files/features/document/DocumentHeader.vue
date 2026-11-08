<template>
  <header
    ref="headerElement"
    class="relative flex shrink-0 items-center gap-2 border-b border-outline-gray-1 bg-surface-base"
    :class="sizeClass"
    :data-save-state="saveState"
  >
    <!-- A centered title lifts the title group into the header, between two
      sides that grow alike; the icon and the way back stay at the start. -->
    <div class="flex min-w-0 flex-1 items-center gap-1" :class="centering.title">
      <div class="contents" :class="centering.start">
        <template v-if="location">
          <Button
            class="md:hidden"
            variant="ghost"
            icon="lucide-chevron-left"
            :route="location.to"
            :aria-label="`Back to ${location.label}`"
          />
          <RouterLink
            :to="location.to"
            class="max-w-48 truncate rounded-4 px-1 text-base text-ink-gray-5 hover:text-ink-gray-8 max-md:hidden"
            :title="location.label"
          >
            {{ location.label }}
          </RouterLink>
          <span class="text-base text-ink-gray-4 max-md:hidden" aria-hidden="true">/</span>
        </template>
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
      <Badge v-if="trashed" label="Trashed" theme="red" variant="subtle" class="shrink-0">
        <template #prefix><span class="lucide-trash-2 size-2.5" aria-hidden="true" /></template>
      </Badge>
      <Badge
        v-else-if="viewOnly"
        label="View only"
        theme="gray"
        variant="subtle"
        class="shrink-0"
      />
      <Badge v-if="!online" label="Offline" theme="amber" variant="subtle" class="shrink-0" />
      <Badge
        v-if="saveState === 'failed'"
        :label="__('Not saved')"
        theme="amber"
        variant="subtle"
        class="shrink-0"
      />
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
      <!-- A compact header says it beside the title, before its menus. -->
      <DocumentEditedNote v-if="isCompact && shownNote" class="ms-1 me-2" v-bind="note" />
      <slot name="status" />
      <slot name="menus" />
    </div>

    <div class="flex shrink-0 items-center gap-1" :class="centering.end">
      <DocumentEditedNote v-if="!isCompact && shownNote" class="mr-1" v-bind="note" />
      <slot name="actions" />
      <Button
        v-for="name in panels"
        :key="name"
        :variant="panel === name ? 'subtle' : 'ghost'"
        :icon="PANEL_BUTTONS[name].icon"
        :tooltip="PANEL_BUTTONS[name].label"
        :aria-label="PANEL_BUTTONS[name].label"
        :aria-pressed="panel === name"
        :data-panel="name"
        @click="panel = panel === name ? null : name"
      />
      <!-- Beside a surface's own primary action, Share is an icon on every width. -->
      <template v-if="session.canShare.value">
        <Button
          v-if="showsShareLabel()"
          class="max-md:hidden"
          variant="ghost"
          label="Share"
          @click="session.share()"
        />
        <Button
          :class="shareIconClass()"
          variant="ghost"
          icon="lucide-share-2"
          tooltip="Share"
          aria-label="Share"
          @click="session.share()"
        />
      </template>
      <Button
        class="max-md:hidden"
        variant="ghost"
        icon="lucide-link"
        :tooltip="__('Copy link')"
        :aria-label="__('Copy link')"
        @click="copyLink(pageAddress())"
      />
      <Button
        v-if="session.canStar.value"
        class="max-md:hidden"
        variant="ghost"
        :tooltip="session.isStarred.value ? __('Unstar') : __('Star')"
        :aria-label="session.isStarred.value ? __('Unstar') : __('Star')"
        :aria-pressed="session.isStarred.value"
        @click="session.setStarred(!session.isStarred.value)"
      >
        <template #icon>
          <StarredIcon v-if="session.isStarred.value" class="size-4" />
          <span v-else class="lucide-star size-4" aria-hidden="true" />
        </template>
      </Button>
      <slot name="menu" />
      <div v-if="$slots.primary" class="ml-1 flex">
        <slot name="primary" />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useNow, useOnline } from '@vueuse/core'
import { Badge, Button, TextInput } from 'frappe-ui'
import { computed, ref, shallowRef, useSlots, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import type { DocumentSession } from '@/apps/drive/client/session'
import type { DocumentPanel } from '@/apps/drive/client/types'
import { selectStem } from '@/apps/drive/files/internal/filename'
import StarredIcon from '@/apps/drive/files/internal/StarredIcon.vue'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

import { canRename } from '../nodeActions'
import { copyLink } from '../share/shareFormat'
import DocumentEditedNote from './DocumentEditedNote.vue'
import { editedDetails, editedLabel } from './editedLabel'
import { documentTypeIcon, PANEL_BUTTONS, type DocumentSaveState } from './header'

/**
 * The one header every document surface shows: the Drive type icon, the title
 * (renamed in place), state badges, the recovery download, when it was last edited, the surface's
 * own actions, the side-panel toggles, Share, Copy link, Star, the surface's menu, then its primary
 * action, always in that order.
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
    /** The side panels this surface has, in toggle order. */
    panels?: readonly DocumentPanel[]
    /** The folder the document is in, shown as a way back. */
    location?: { label: string; to: RouteLocationRaw } | null
    /** A file's MIME type picks its icon. Documents have none. */
    mime?: string | null
    /**
     * `centered` centers the title across the header on wide screens. `compact`
     * is a 40-px header for a surface that adds its own menu bar (the `menus`
     * slot): when it was edited moves beside the title, ahead of the menus.
     */
    layout?: 'default' | 'centered' | 'compact'
  }>(),
  {
    saveState: null,
    saveNote: '',
    viewOnly: false,
    recoverable: false,
    panels: () => [],
    location: null,
    mime: null,
    layout: 'default',
  },
)

const emit = defineEmits<{ downloadChanges: [] }>()
const panel = defineModel<DocumentPanel | null>('panel', { default: null })

const slots = useSlots()
const online = useOnline()
const headerElement = ref<HTMLElement | null>(null)
const titleInput = ref<InstanceType<typeof TextInput> | null>(null)
const titleDraft = ref(props.session.title.value)
/** A centered title sits between two sides that grow alike. */
const CENTERED = {
  title: 'md:contents',
  start: 'md:flex md:flex-1 md:items-center md:gap-1',
  end: 'md:flex-1 md:justify-end',
}
const UNCENTERED = { title: '', start: '', end: '' }
const isCompact = computed(() => props.layout === 'compact')
const sizeClass = computed(() => (isCompact.value ? 'h-10 px-3' : 'h-12 px-3 sm:px-4'))
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
  class: ['whitespace-nowrap text-sm text-ink-gray-5', props.saveNote ? '' : 'max-md:hidden'],
  'aria-live': props.saveNote ? 'polite' : 'off',
  text: shownNote.value,
  details: noteDetails.value,
}))
const centering = computed(() => (props.layout === 'centered' ? CENTERED : UNCENTERED))
const trashed = computed(() => props.session.state.value === 'Trashed')
const renamable = computed(() =>
  canRename({ state: props.session.state.value, access: props.session.access.value }),
)
const typeIcon = computed(() =>
  documentTypeIcon(props.session.contentDoctype, props.session.title.value, props.mime),
)
// read on every render: slots are not reactive
function showsShareLabel() {
  return !slots.primary
}

function shareIconClass() {
  return slots.primary ? '' : 'md:hidden'
}

function pageAddress() {
  return window.location.pathname + window.location.search
}

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
    // Drive names a free title only when the title is taken. Its own message
    // for that is written for developers.
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
  /** Focuses a side panel's toggle, for a panel closed from inside itself. */
  focusPanelToggle(name: DocumentPanel) {
    headerElement.value?.querySelector<HTMLElement>('[data-panel="' + name + '"]')?.focus()
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
