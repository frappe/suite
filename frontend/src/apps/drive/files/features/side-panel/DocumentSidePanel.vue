<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core'
import { Button, TextInput, toast } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import type { DocumentPanel, DocumentSession, DocumentVersion } from '@/apps/drive'
import type { VersionRestored } from '@/platform/collab'
import { restoredByOther } from '@/platform/collab/restoreNotices'

import CommentList from './comments/CommentList.vue'
import type { FileNoun, ThreadPlaces } from './comments/places'
import type { DocumentComments } from './comments/useDocumentComments'
import { useDocumentPanel } from './versions/useDocumentPanel'
import VersionList from './versions/VersionList.vue'

const props = defineProps<{
  session: DocumentSession
  canComment: boolean
  canEditDocument: boolean
  /** Whether the person can share the document, which needs Manage. */
  canShare: boolean
  canRestoreVersion: boolean
  canSaveVersion: boolean
  isRestoringVersion: boolean
  /** The version the app shows; the panel asks for a change by update:previewedVersion. */
  previewedVersion: DocumentVersion | null
  /** The document's threads, their actions and drafts, as useDocumentComments gives them. */
  comments: DocumentComments
  /** Where each thread shows in the editor; null when the editor can't tell. */
  places: ThreadPlaces | null
  /** Saves the document's pending edits, throwing why it couldn't. */
  saveFirst: () => Promise<void>
  /** What the app calls the file, in the comment panel's messages. */
  noun: FileNoun
}>()

const panel = defineModel<DocumentPanel | null>('panel', { required: true })
const emit = defineEmits<{
  closed: [panel: DocumentPanel]
  restoreVersion: [version: DocumentVersion]
  downloadVersion: [version: DocumentVersion]
  /** Escape over a shown version, which goes back as the bar's Back does. */
  back: []
  commentSent: []
  'update:previewedVersion': [version: DocumentVersion | null]
}>()
const openThread = defineModel<string | null>('openThread', { default: null })
const litThread = defineModel<string | null>('litThread', { default: null })

const { lists, load, loadMoreVersions, saveVersion, renameVersion } = useDocumentPanel(
  props.session,
  props.comments.refresh,
)

const isSavingVersion = ref(false)
const isNamingVersion = ref(false)
const versionName = ref('')
const versionNameInput = ref<{ focus(): void } | null>(null)
const commentList = ref<InstanceType<typeof CommentList> | null>(null)

const isCommentsPanel = computed(() => panel.value === 'comments')
const title = computed(() => (isCommentsPanel.value ? 'Comments' : 'Versions'))
const hasNoVersions = computed(() => !lists.versions.length)
const showsVersionName = computed(() => isNamingVersion.value && panel.value === 'versions')
const versionRename = computed(() => (props.canSaveVersion ? renameShownVersion : undefined))
const versionNameHint = computed(() =>
  isSavingVersion.value ? 'Saving first…' : 'Enter to save · Esc to cancel',
)

watch(
  panel,
  (kind) => {
    if (kind) {
      void load(kind)
    }

    if (kind !== 'versions') {
      stopNamingVersion()
    }
  },
  { immediate: true },
)

// Escape leaves a version shown, unless a dialog or menu over it takes the key
onKeyStroke(
  'Escape',
  (event) => {
    const isOverlayOpen = document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
    if (!event.defaultPrevented && props.previewedVersion && !isOverlayOpen) {
      emit('back')
    }
  },
  { target: document },
)

watch(
  () => props.previewedVersion,
  () => {
    if (!versionName.value.trim()) {
      stopNamingVersion()
    }
  },
)

function closePanel() {
  const closed = panel.value
  panel.value = null
  if (closed) {
    emit('closed', closed)
  }
}

// Opens a name box at the top of the list; Enter saves, Esc or an empty name cancels
async function startNamingVersion() {
  isNamingVersion.value = true
  await nextTick()
  versionNameInput.value?.focus()
}

// The name box opens once the panel has seen any preview close, which would otherwise cancel it;
// the app hears it even with no version shown, so it closes any other preview, like a recovery copy
async function nameVersion() {
  emit('update:previewedVersion', null)
  panel.value = 'versions'
  await nextTick()
  await startNamingVersion()
}

function stopNamingVersion() {
  isNamingVersion.value = false
  versionName.value = ''
}

async function saveNamedVersion() {
  const label = versionName.value.trim()
  if (!label) {
    stopNamingVersion()
    return
  }

  isSavingVersion.value = true
  let isSaved = false
  try {
    isSaved = await saveVersion(label, props.saveFirst)
  } finally {
    isSavingVersion.value = false
  }

  if (isSaved) {
    stopNamingVersion()
    return
  }

  // The box was disabled while saving, which drops its focus
  await nextTick()
  versionNameInput.value?.focus()
}

// The bar over a viewed version names it, so it takes the new name too
async function renameShownVersion(version: DocumentVersion, label: string) {
  const renamed = await renameVersion(version, label)
  if (renamed && props.previewedVersion?.seq === version.seq) {
    emit('update:previewedVersion', renamed)
  }

  return !!renamed
}

// Opens the comments panel with the whole-document box ready to type in
async function startDocumentComment() {
  panel.value = 'comments'
  await nextTick()
  await commentList.value?.startDocumentComment()
}

// Someone else restored a version: the list reads again, and the person is told who and which
async function tellRestoredByOther(restored: VersionRestored) {
  void load('versions')
  toast.info(await restoredByOther(restored, props.noun))
}

defineExpose({
  reloadVersions: () => load('versions'),
  nameVersion,
  startDocumentComment,
  tellRestoredByOther,
})
</script>

<template>
  <Transition
    enter-active-class="md:transition-[width] md:duration-150 md:ease-in-out"
    enter-from-class="md:!w-0"
    leave-active-class="md:transition-[width] md:duration-150 md:ease-in-out"
    leave-to-class="md:!w-0"
  >
    <aside
      v-if="panel"
      :aria-label="title"
      class="absolute bottom-0 right-0 top-0 z-20 w-full overflow-hidden border-l border-outline-gray-1 bg-surface-elevation-1 md:static md:box-content md:w-80 md:shrink-0 md:bg-surface-base"
    >
      <div class="flex h-full w-full flex-col md:w-80 md:p-2">
        <div
          class="flex min-h-12 items-center justify-between border-b pl-7 pr-4 md:min-h-0 md:border-b-0 md:pb-1 md:pl-3 md:pr-1.5"
        >
          <h2 class="text-lg-semibold md:text-base-medium md:text-ink-gray-8">
            {{ title }}
          </h2>
          <Button
            icon="lucide-x"
            :aria-label="__('Close panel')"
            variant="ghost"
            @click="closePanel"
          />
        </div>
        <div
          class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 [scrollbar-width:none] md:px-1 md:pb-2 md:pt-0.5 [&::-webkit-scrollbar]:hidden"
        >
          <div v-if="showsVersionName" class="space-y-1">
            <TextInput
              ref="versionNameInput"
              v-model="versionName"
              :placeholder="__('Version name')"
              :aria-label="__('Version name')"
              :disabled="isSavingVersion"
              @keydown.enter.prevent="saveNamedVersion"
              @keydown.esc.prevent="stopNamingVersion"
            />
            <p class="text-p-xs text-ink-gray-5">{{ versionNameHint }}</p>
          </div>
          <CommentList
            v-if="isCommentsPanel"
            ref="commentList"
            v-model:open-thread="openThread"
            v-model:lit-thread="litThread"
            :threads="comments.threads.value"
            :read-at="comments.readAt.value"
            :node="session.nodeId"
            :places
            :can-comment
            :can-edit-document
            :can-share
            :actions="comments.actions"
            :drafts="comments.drafts"
            :noun
            @sent="emit('commentSent')"
          />
          <p v-else-if="lists.isLoading" class="px-2 text-sm text-ink-gray-5">
            {{ __('Loading…') }}
          </p>
          <template v-else>
            <VersionList
              :previewed="previewedVersion"
              :versions="lists.versions"
              :can-restore="canRestoreVersion"
              :is-restoring="isRestoringVersion"
              :can-save-version="canSaveVersion"
              :is-current-hidden="showsVersionName"
              :rename="versionRename"
              @update:previewed="(shown) => emit('update:previewedVersion', shown)"
              @restore="emit('restoreVersion', $event)"
              @download="emit('downloadVersion', $event)"
              @save-version="nameVersion"
            />
            <p v-if="hasNoVersions" class="px-2 text-sm text-ink-gray-5">
              {{ __('No versions yet.') }}
            </p>
            <Button
              v-if="lists.versionsCursor"
              class="w-full"
              variant="ghost"
              :label="__('Load more')"
              :loading="lists.isLoadingMore"
              @click="loadMoreVersions"
            />
          </template>
        </div>
      </div>
    </aside>
  </Transition>
</template>
