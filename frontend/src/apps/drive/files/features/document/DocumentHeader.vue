<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 bg-surface-base px-3 sm:px-5">
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
      <TextInput
        ref="titleInput"
        v-model="titleDraft"
        class="document-title min-w-0 max-w-md flex-1"
        variant="ghost"
        :readonly="!renamable"
        :aria-label="titleLabel"
        :title="session.title.value"
        @blur="rename"
        @keydown.stop
        @keydown.enter.prevent="blurTitle"
        @keydown.escape.prevent="titleDraft = session.title.value; blurTitle()"
      />
      <Badge v-if="trashed" label="Trashed" theme="gray" variant="subtle" class="shrink-0" />
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
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'
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
const renamable = computed(
  () => props.session.state.value === 'Active' && (props.session.access.value.role ?? 0) >= DRIVE_ROLES.edit,
)
const typeIcon = computed(() => documentTypeIcon(props.session.contentDoctype, props.mime))

watch(() => props.session.title.value, (title) => { titleDraft.value = title })

function blurTitle() {
  titleInput.value?.inputElement?.blur()
}

async function rename() {
  const title = titleDraft.value.trim()
  if (!title || title === props.session.title.value || !renamable.value) {
    titleDraft.value = props.session.title.value
    return
  }
  try {
    await props.session.rename(title)
  } catch (error) {
    titleDraft.value = props.session.title.value
    toast.error(error instanceof Error ? error.message : 'Could not rename this file.')
  }
}

defineExpose({
  /**
   * Puts the caret in the title with the whole name selected, for a Rename menu
   * item. A closing menu hands focus back to its trigger a moment later, so the
   * title takes it back once if that happens straight away.
   */
  focusTitle() {
    const input = titleInput.value?.inputElement
    if (!input) return
    const take = () => {
      input.focus()
      input.select()
    }
    take()
    document.addEventListener('focusin', take, { once: true })
    setTimeout(() => document.removeEventListener('focusin', take), 250)
  },
})
</script>

<style scoped>
/* The title reads as a heading; it turns into a field on hover and focus. */
.document-title :deep([data-slot='control']) {
  font-weight: 500;
  text-overflow: ellipsis;
}
.document-title :deep([data-slot='control'][readonly]) {
  background: transparent;
  cursor: default;
}
</style>
