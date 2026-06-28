<template>
  <div
    class="text-ink-gray-8 flex flex-col items-start fixed bottom-0 right-0 m-5 w-96 z-1 rounded-2xl overflow-hidden shadow-2xl border border-outline-gray-1 bg-surface-base p-4"
  >
    <div
      class="flex items-center justify-between w-full pr-1.5"
      :class="[collapsed ? 'cursor-pointer' : 'mb-4']"
      @click="collapsed = false"
    >
      <div v-if="uploadsInProgress.length > 0" class=" truncate text-xl-medium">
        Uploading {{ uploadsInProgress.length }}
        {{ uploadsInProgress.length == 1 ? 'file' : 'files' }}
      </div>
      <div v-else-if="uploadsCompleted.length > 0" class=" truncate text-xl-medium">
        {{ uploadsCompleted.length }}
        {{ uploadsCompleted.length == 1 ? 'file' : 'files' }} uploaded
      </div>
      <div v-else-if="uploadsFailed.length > 0" class=" truncate text-xl-medium">
        {{ uploadsFailed.length }}
        {{ uploadsFailed.length == 1 ? 'upload' : 'uploads' }} failed
      </div>
      <div class="ml-auto flex items-center gap-4">
        <button class="focus:outline-none" @click.stop="collapsed = !collapsed">
          <component :is="collapsed ? LucidePlus : LucideMinus" class="size-4 text-ink-gray-8" />
        </button>
        <button class="focus:outline-none" @click="clearUploads()">
          <LucideX class="size-4 text-ink-gray-8" />
        </button>
      </div>
    </div>
    <div v-if="!collapsed" class="max-h-64 overflow-y-auto bg-surface-base w-full">
      <div
        v-for="(upload, index) in currentTabGetter()"
        :key="upload.uuid"
        class="cursor-pointer truncate hover:bg-surface-sidebar rounded px-1 group"
        @mouseover="hoverIndex = index"
        @mouseout="hoverIndex = null"
      >
        <div class="flex items-center gap-3 py-1 pr-[3px]" @click="openFile(upload)">
          <div class="flex items-center justify-between w-full">
            <div class="flex justify-start items-center w-full max-w-[80%]">
              <LucideFile class="size-4 mr-2" />
              <p class="truncate text-sm leading-6 col-span-1 row-span-1">
                {{ upload.name }}
              </p>
            </div>
            <Button
              v-if="upload.completed"
              variant="ghost"
              :icon="upload.error ? LucideInfo : LucideFolderOpenDot"
            />
            <ProgressRing
              v-if="!upload.completed && !upload.error"
              :radius="13"
              :progress="Math.min(upload.progress, 98)"
            />
            <Button
              v-if="upload.error"
              variant="ghost"
              :icon="LucideRefreshCcw"
              class="rounded-full hover:bg-surface-gray-2"
              @click.stop="emitter.emit('retryUpload', upload.uuid)"
            />
            <!-- <Button
              variant="ghost"
              :icon="LucideX"
              class="rounded-full hover:bg-surface-red-4"
              @click="emitter.emit('cancelUpload', upload.uuid)"
            /> -->
          </div>
        </div>
      </div>
    </div>
    <Dialog
      v-if="showErrorDialog"
      v-model:open="showErrorDialog"
      title="Upload failed"
      :message="selectedUpload.error"
      size="sm"
      :actions="[
        {
          label: 'OK',
          variant: 'solid',
          onClick: () => {
            showErrorDialog = false
          },
        },
      ]"
    />
  </div>
</template>
<script setup>
import { Dialog, Button} from 'frappe-ui'
import ProgressRing from '@/apps/drive/components/ProgressRing.vue'
import LucideInfo from '~icons/lucide/info'
import LucidePlus from '~icons/lucide/plus'
import LucideMinus from '~icons/lucide/minus'
import LucideFolderOpenDot from '~icons/lucide/folder-open-dot'
import LucideX from '~icons/lucide/x'
import LucideRefreshCcw from '~icons/lucide/refresh-ccw'
import { uploadsInProgress, uploadsCompleted, uploadsFailed, clearUploads } from '@/apps/drive/data/uploads'
import { useRouter } from 'vue-router'
import { ref } from 'vue'

const collapsed = ref(false)
const showErrorDialog = ref(false)
const hoverIndex = ref(null)
const selectedUpload = ref(null)

const router = useRouter()

const currentTabGetter = () => {
  return uploadsFailed.value.concat(uploadsInProgress.value, uploadsCompleted.value)
}

const openFile = (upload) => {
  selectedUpload.value = upload
  if (upload.error) {
    showErrorDialog.value = true
  }
  if (upload.completed && upload.response) {
    router.push({
      name: 'drive-File',
      params: { entityName: upload.response.name },
    })
  }
}
</script>
