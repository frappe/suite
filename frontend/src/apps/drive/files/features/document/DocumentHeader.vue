<template>
  <header class="relative flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 bg-surface-base px-3 sm:px-5">
    <div class="flex min-w-0 flex-1 items-center gap-1">
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
      <span class="size-4 shrink-0" :class="typeIcon" aria-hidden="true" />
      <!-- The hidden copy of the title gives the field its width, so the field
        fits its text and a refusal sits right after it. -->
      <div class="document-title relative min-w-0 max-w-md">
        <span class="invisible block h-7 overflow-hidden whitespace-pre ps-2 pe-2.5 text-base font-medium" aria-hidden="true">{{ titleDraft || ' ' }}</span>
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
          @keydown.escape.prevent="titleDraft = session.title.value; blurTitle()"
        />
      </div>
      <span v-if="titleError" class="title-refusal ms-1 min-w-0 max-w-64 truncate text-sm text-ink-red-7" role="alert" :title="titleError">
        {{ titleError }}
      </span>
      <Badge v-if="trashed" label="Trashed" theme="red" variant="subtle" class="shrink-0">
        <template #prefix><span class="lucide-trash-2 size-2.5" aria-hidden="true" /></template>
      </Badge>
      <Badge v-else-if="viewOnly" label="View only" theme="gray" variant="subtle" class="shrink-0" />
      <Badge v-if="!online" label="Offline" theme="amber" variant="subtle" class="shrink-0" />
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

    <div class="flex shrink-0 items-center gap-1">
      <!-- A clean or saving document says so on wide screens only; a failed save always shows. -->
      <span
        v-if="saveState"
        class="mr-1 whitespace-nowrap text-sm"
        :class="[saveState === 'failed' ? 'text-ink-red-6' : 'text-ink-gray-5', saveState !== 'failed' && 'max-md:hidden']"
        aria-live="polite"
      >
        {{ SAVE_LABELS[saveState] }}
      </span>
      <slot name="actions" />
      <Button
        v-for="name in panels"
        :key="name"
        :variant="panel === name ? 'subtle' : 'ghost'"
        :icon="PANEL_BUTTONS[name].icon"
        :tooltip="PANEL_BUTTONS[name].label"
        :aria-label="PANEL_BUTTONS[name].label"
        :aria-pressed="panel === name"
        @click="panel = panel === name ? null : name"
      />
      <template v-if="session.canShare.value">
        <Button class="ml-1 max-md:hidden" variant="solid" icon-left="lucide-share-2" label="Share" @click="session.share()" />
        <Button class="md:hidden" variant="ghost" icon="lucide-share-2" tooltip="Share" aria-label="Share" @click="session.share()" />
      </template>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useOnline } from '@vueuse/core'
import { Badge, Button, TextInput } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

import type { DocumentSession } from '@/apps/drive/client/session'
import { selectStem } from '@/apps/drive/files/internal/filename'
import { canRename } from '../nodeActions'
import { PANEL_BUTTONS, SAVE_LABELS, documentTypeIcon, type DocumentPanel, type DocumentSaveState } from './header'

/**
 * The one header every document surface shows: the Drive type icon, the title
 * (renamed in place), state badges, the recovery download, the save status, the surface's own actions,
 * the side-panel toggles and Share, always in that order.
 */
const props = withDefaults(defineProps<{
  session: DocumentSession
  /** The title field's accessible name, such as "Spreadsheet title". */
  titleLabel: string
  /** Omitted for content that has no save state, such as a file preview. */
  saveState?: DocumentSaveState | null
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
}>(), {
  saveState: null,
  viewOnly: false,
  recoverable: false,
  panels: () => [],
  location: null,
  mime: null,
})

const emit = defineEmits<{ downloadChanges: [] }>()
const panel = defineModel<DocumentPanel | null>('panel', { default: null })

const online = useOnline()
const titleInput = ref<InstanceType<typeof TextInput> | null>(null)
const titleDraft = ref(props.session.title.value)
const trashed = computed(() => props.session.state.value === 'Trashed')
const renamable = computed(() => canRename({ state: props.session.state.value, access: props.session.access.value }))
const typeIcon = computed(() => documentTypeIcon(props.session.contentDoctype, props.session.title.value, props.mime))

/** A refused rename, shown beside the title until the title changes. */
const titleError = ref<string>()

watch(() => props.session.title.value, (title) => { titleDraft.value = title })
watch(titleDraft, () => { titleError.value = undefined }, { flush: 'sync' })

function blurTitle() {
  titleInput.value?.inputElement?.blur()
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
    return error instanceof Error ? error.message : 'Could not rename this file.'
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
