<script setup lang="ts">
import { Button } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'
import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import {
  driveDocumentIcon,
  DriveListSkeletonRows,
  driveNodeRoute,
  formatDriveBytes,
  formatDriveListingDate,
  loadDriveNodeSummary,
  useDriveSkeletonDelay,
  type DriveSkeletonCell,
} from '@/apps/drive'
import { slidesDocument } from '@/apps/slides'
import { confirm, Dropdown } from '@/platform/feedback'

import { discardCopy, downloadCopy, listCopies, savedAtLabel, type RecoveryCopy } from './copies'

/** Every Slides copy this device keeps, also of presentations the person can no longer open. */
const copies = shallowRef<RecoveryCopy[]>([])
const router = useRouter()

const isLoading = shallowRef(true)
// Drive's order: nothing for a fast read, placeholder rows for a slow one, then the list
const isBlank = useDriveSkeletonDelay(isLoading)
const hasNoCopies = computed(() => !isLoading.value && !copies.value.length)
// Writer's tracks on this page; a phone drops the saved time, as Drive drops Modified
const COLUMNS = {
  base: ['minmax(0,1fr)', '6rem', '2.5rem'],
  md: ['minmax(0,1fr)', '6rem', '8rem', '2.5rem'],
}
const SKELETON_CELLS: DriveSkeletonCell[] = [
  {},
  { class: 'hidden justify-end md:flex', hasDate: true },
]
const icon = driveDocumentIcon(slidesDocument.contentDoctype)

onMounted(async () => {
  await refresh()
  isLoading.value = false
})

async function refresh() {
  copies.value = await listCopies()
}

// The presentation shows its own copy; one the person can't open stays here to download
async function open(copy: RecoveryCopy) {
  if (!copy.node) {
    return
  }

  const node = await loadDriveNodeSummary(copy.node).catch(() => null)
  if (node && node.state !== 'Trashed') {
    await router.push(driveNodeRoute(node))
  }
}

async function discard(copy: RecoveryCopy) {
  const isConfirmed = await confirm({
    title: 'Discard recovery copy?',
    message: "This deletes the copy from this device. It can't be brought back.",
    confirmLabel: 'Discard',
    destructive: true,
  })
  if (!isConfirmed) {
    return
  }

  await discardCopy(copy)
  await refresh()
}

function options(copy: RecoveryCopy) {
  return [
    { label: 'Download', icon: 'lucide-download', onClick: () => downloadCopy(copy) },
    {
      label: 'Discard',
      icon: 'lucide-trash-2',
      theme: 'red' as const,
      onClick: () => discard(copy),
    },
  ]
}

function titleOf(copy: RecoveryCopy) {
  return copy.title || 'Untitled presentation'
}

function savedAt(copy: RecoveryCopy) {
  return formatDriveListingDate(copy.savedAt.toISOString())
}
</script>

<template>
  <div v-if="isBlank" aria-busy="true" />
  <div
    v-else-if="hasNoCopies"
    class="flex flex-col items-center justify-center gap-2 py-16 text-center"
  >
    <span class="lucide-folder-open size-6 text-ink-gray-4" aria-hidden="true" />
    <p class="text-base text-ink-gray-5">{{ __('No recovery copies') }}</p>
    <p class="text-p-sm text-ink-gray-5">
      {{ __("Changes that couldn't be saved stay here, on this device, until you discard them.") }}
    </p>
  </div>
  <List
    v-else
    :columns="COLUMNS"
    :row-height="40"
    class="-mx-3 list-row-px-3"
    :aria-busy="isLoading"
  >
    <ListHeader>
      <ListHeaderCell class="text-sm-medium text-ink-gray-5">{{ __('Name') }}</ListHeaderCell>
      <ListHeaderCell class="justify-end text-sm-medium text-ink-gray-5">{{
        __('Size')
      }}</ListHeaderCell>
      <ListHeaderCell class="hidden justify-end text-sm-medium text-ink-gray-5 md:flex">
        {{ __('Saved') }}
      </ListHeaderCell>
      <ListHeaderCell
        ><span class="sr-only">{{ __('Actions') }}</span></ListHeaderCell
      >
    </ListHeader>
    <DriveListSkeletonRows v-if="isLoading" :cells="SKELETON_CELLS" />
    <template v-else>
      <ListRow
        v-for="copy in copies"
        :key="copy.key"
        :value="copy.key"
        tabindex="0"
        class="select-none"
        @click="open(copy)"
      >
        <ListCell>
          <span class="mr-2 size-4 shrink-0" :class="icon" aria-hidden="true" />
          <span class="min-w-0 truncate text-base text-ink-gray-8" :title="titleOf(copy)">{{
            titleOf(copy)
          }}</span>
        </ListCell>
        <ListCell class="justify-end">
          <span class="truncate text-base text-ink-gray-5">{{ formatDriveBytes(copy.size) }}</span>
        </ListCell>
        <ListCell class="hidden justify-end md:flex">
          <span class="truncate text-base text-ink-gray-5">{{ savedAt(copy) }}</span>
        </ListCell>
        <ListCell class="justify-end">
          <Dropdown :options="options(copy)" align="end">
            <Button
              icon="lucide-ellipsis"
              variant="ghost"
              :aria-label="`Actions for the copy from ${savedAtLabel(copy)}`"
              @click.stop
            />
          </Dropdown>
        </ListCell>
      </ListRow>
    </template>
  </List>
</template>
