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
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { uploadQueue, type UploadTarget } from './queue'
import { foldersFromInput, type UploadSelection } from './sources'

/**
 * Where a page starts uploads: the pickers and dropped selections. The queue,
 * its questions and the tracker live at the app root (`progress.ts`,
 * `UploadTracker.vue`), so uploads and their dialogs outlive the page.
 */
const queue = uploadQueue()
const filesInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
let pending: UploadTarget | null = null

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

defineExpose({ pickFiles, pickFolder, upload })
</script>
