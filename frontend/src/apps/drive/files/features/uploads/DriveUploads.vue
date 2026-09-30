<template>
  <!-- Hidden pickers. A folder picker needs `webkitdirectory`, which phones ignore. -->
  <input
    ref="filesInput"
    data-slot="upload-files-input"
    type="file"
    multiple
    class="hidden"
    @change="takeFiles"
  />
  <input
    ref="folderInput"
    data-slot="upload-folder-input"
    type="file"
    webkitdirectory
    class="hidden"
    @change="takeFolder"
  />
  <input
    ref="resumeInput"
    data-slot="upload-resume-input"
    type="file"
    class="hidden"
    @change="takeResume"
    @cancel="settleResume(null)"
  />
  <UploadTracker :queue="queue" />
</template>

<script setup lang="ts">
import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'

import { uploadPrompts } from './prompts'
import { uploadQueue, type UploadQueue, type UploadTarget } from './queue'
import { foldersFromInput, type UploadSelection } from './sources'
import UploadTracker from './UploadTracker.vue'

/**
 * Everything a page needs to start uploads: the pickers, the tracker and the
 * dialogs the queue asks. Mount it once where uploads start.
 */
const props = defineProps<{ queue?: UploadQueue }>()
const queue = props.queue ?? uploadQueue()
const filesInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const resumeInput = ref<HTMLInputElement>()
let pending: UploadTarget | null = null
let resumeAnswer: ((file: File | null) => void) | null = null

const context = getCurrentInstance()!.appContext
const prompts = uploadPrompts(context, () =>
  new Promise<File | null>((resolve) => {
    settleResume(null)
    resumeAnswer = resolve
    resumeInput.value!.value = ''
    resumeInput.value!.click()
  }),
)
queue.setPrompts(prompts)
onBeforeUnmount(() => {
  queue.setPrompts(null)
  settleResume(null)
})

function pickFiles(target: UploadTarget) {
  pending = target
  filesInput.value!.value = ''
  filesInput.value!.click()
}

function pickFolder(target: UploadTarget) {
  pending = target
  folderInput.value!.value = ''
  folderInput.value!.click()
}

/** Files and folders from a drop or any other source. */
async function upload(selection: UploadSelection, target: UploadTarget) {
  if (selection.folders.length) await queue.uploadFolders(selection.folders, target)
  if (selection.files.length) await queue.uploadFiles(selection.files, target)
}

function takeFiles() {
  const files = [...(filesInput.value?.files ?? [])]
  if (!pending || !files.length) return
  void queue.uploadFiles(files.map((file) => ({ file })), pending)
}

function takeFolder() {
  const folders = foldersFromInput([...(folderInput.value?.files ?? [])])
  if (!pending || !folders.length) return
  void queue.uploadFolders(folders, pending)
}

function takeResume() {
  settleResume(resumeInput.value?.files?.[0] ?? null)
}

function settleResume(file: File | null) {
  resumeAnswer?.(file)
  resumeAnswer = null
}

defineExpose({ pickFiles, pickFolder, upload })
</script>
