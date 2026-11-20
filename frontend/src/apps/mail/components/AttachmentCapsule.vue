<template>
  <!-- A thread's card for a file: a tile with the file's type, its name over its size, and a
       download of its own, wide enough to tap. Its width is the caller's. -->
  <div
    v-if="row"
    class="hover:bg-surface-gray-1 flex cursor-pointer items-center gap-3 rounded-6 border p-2"
  >
    <span
      class="bg-surface-gray-2 flex size-9 shrink-0 items-center justify-center rounded-4"
      aria-hidden="true"
    >
      <component :is="getFileIcon(type)" class="size-5" />
    </span>
    <span class="min-w-0 flex-1">
      <!-- The whole name on hover, where the card's width cuts it. -->
      <Tooltip :text="fileName" :disabled="isMobile">
        <span v-if="nameParts" class="text-ink-gray-8 flex min-w-0 text-base">
          <span class="truncate">{{ nameParts.head }}</span>
          <span class="shrink-0 whitespace-pre">{{ nameParts.tail }}</span>
        </span>
        <span v-else class="text-ink-gray-8 block truncate text-base">{{ fileName }}</span>
      </Tooltip>
      <span v-if="size" class="text-ink-gray-5 block text-sm">{{ formatBytes(size) }}</span>
    </span>
    <Button
      v-if="blobID"
      variant="ghost"
      class="touch-target shrink-0"
      :loading="isDownloading"
      :aria-label="__('Download {0}', [fileName])"
      @click.stop.prevent="downloadAttachment"
    >
      <template #icon>
        <Download class="text-ink-gray-5 icon" />
      </template>
    </Button>
  </div>
  <div
    v-else
    class="group/capsule hover:border-outline-gray-3 flex cursor-pointer items-center rounded-full border"
    :class="compact ? 'h-7 gap-1.5 px-2.5' : 'space-x-1.5 px-2 py-1'"
  >
    <div class="text-ink-gray-4">
      <Loader v-if="isDownloading || progress !== undefined" class="size-4 shrink-0 animate-spin" />
      <template v-else>
        <component
          :is="getFileIcon(type)"
          class="size-4 shrink-0"
          :class="{ 'sm:group-hover/capsule:hidden': blobID }"
        />
        <button
          class="hidden"
          :class="{ 'sm:group-hover/capsule:block': blobID }"
          :aria-label="__('Download {0}', [fileName])"
          @click.stop.prevent="downloadAttachment"
        >
          <Download class="hover:text-ink-gray-8 size-4 shrink-0" />
        </button>
      </template>
    </div>
    <!-- Cut in the middle: the head gives way with an ellipsis at whatever width the pill has,
         and the tail — the extension and a few characters before it — always shows. One span
         around both, so the capsule's spacing doesn't open a gap between the halves. -->
    <span v-if="nameParts" class="flex min-w-0" :class="textSize">
      <span class="truncate">{{ nameParts.head }}</span>
      <span class="shrink-0 whitespace-pre">{{ nameParts.tail }}</span>
    </span>
    <span v-else class="truncate" :class="textSize">{{ fileName }}</span>
    <!-- While uploading, how far along; once attached, how big. -->
    <span v-if="progress !== undefined" class="text-ink-gray-5 shrink-0 text-sm tabular-nums">
      {{ Math.round(progress) }}%
    </span>
    <span v-else-if="size" class="text-ink-gray-5 shrink-0 text-sm">{{ formatBytes(size) }}</span>
    <button
      v-if="removable"
      type="button"
      class="text-ink-gray-5 hover:text-ink-gray-8 -mr-0.5 flex shrink-0 rounded-full p-0.5"
      :aria-label="__('Remove {0}', [fileName])"
      @click.stop.prevent="emit('remove')"
    >
      <span class="lucide-x size-3.5" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Button, Tooltip } from 'frappe-ui'
import { Download, Loader } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { getAttachmentUrl } from '@/apps/mail/resources'
import { downloadUrlAsFile, formatBytes, getFileIcon } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'

const {
  fileName,
  blobID,
  type,
  account,
  size,
  progress,
  removable = false,
  truncateMiddle = false,
  compact = false,
  row = false,
} = defineProps<{
  fileName: string
  blobID?: string
  type?: string
  // The blob's owning account (merged lists / cross-account panes); active when unset.
  account?: string
  // In the composer: the file's size once attached, its upload progress (0–100) while it is on
  // its way, and an ✕ that takes it off the mail.
  size?: number
  progress?: number
  removable?: boolean
  // Cut a long name in the middle on desktop too, as the phone always does, so the extension shows.
  truncateMiddle?: boolean
  // A mail list row's line of chips: the height, padding and type of the folder Badges beside it.
  compact?: boolean
  // A card, with the file's size and a download button, as a thread lists them; its name is cut in
  // the middle, so the extension shows.
  row?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const { isMobile } = useScreenSize()

const textSize = computed(() => (compact ? 'text-p-sm' : 'text-sm'))

// On mobile (and wherever `truncateMiddle` asks) long names truncate in the middle so the
// extension survives ("quarterly-rep…-final.pdf", not "quarterly-repo…"). Desktop otherwise keeps
// CSS end-truncation, whose tooltip shows the full name on hover anyway. The split is the name's;
// where the cut falls is the browser's, so it is right at any width.
const TAIL_BEFORE_EXTENSION = 4
const nameParts = computed(() => {
  if (!isMobile.value && !truncateMiddle && !row) return null
  const dot = fileName.lastIndexOf('.')
  const extension = dot > 0 && fileName.length - dot <= 10 ? fileName.length - dot : 0
  const tailLength = extension + TAIL_BEFORE_EXTENSION
  if (fileName.length <= tailLength + 4) return null
  return { head: fileName.slice(0, -tailLength), tail: fileName.slice(-tailLength) }
})

const isDownloading = ref(false)

const downloadAttachment = async () => {
  if (!blobID) return

  isDownloading.value = true
  try {
    const url = await getAttachmentUrl(blobID, type, account)
    downloadUrlAsFile(url, fileName || 'attachment')
  } catch {
    // the resource's onError already raised a toast; just stop spinning
  } finally {
    isDownloading.value = false
  }
}
</script>
