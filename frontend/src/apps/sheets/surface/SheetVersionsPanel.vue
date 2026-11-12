<script setup lang="ts">
import { Badge, Button, dialog, Dropdown, Skeleton, toast, type DropdownOptions } from 'frappe-ui'
import { nextTick, onMounted, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

import type { SheetVersion } from './records'
import { errorText, versionByline, versionTitle, type VersionList } from './versions'

const props = defineProps<{
  session: DocumentSession
  /** The versions, kept by the surface: the panel remounts with the editor during a preview. */
  list: VersionList
  writable: boolean
  /** A copy can be made in the sheet's folder. */
  canCopy: boolean
  /** The version shown in the editor; null for the sheet as it is now. */
  previewed: string | null
  /** Saves pending edits. Rejects while any edit is still unsaved. */
  flush: () => Promise<void>
}>()
const emit = defineEmits<{
  close: []
  preview: [version: SheetVersion | null]
  rename: [version: SheetVersion]
  copy: [version: SheetVersion]
  restore: [version: SheetVersion]
}>()

const scroller = ref<HTMLElement | null>(null)

function saveVersion() {
  dialog.prompt({
    title: __('Save a version'),
    fields: [
      {
        name: 'label',
        label: __('Name'),
        required: true,
        placeholder: __('Before the Q3 import'),
      },
    ],
    confirmLabel: __('Save'),
    onConfirm: async ({ values }) => {
      // A version is the saved state: the edits still pending go in first.
      await props.flush()
      await props.session.versions.create('named', String(values.label ?? '').trim())
      toast.success(__('Version saved'))
      await props.list.load()
    },
  })
}

async function loadMore() {
  try {
    await props.list.loadMore()
  } catch (error) {
    toast.error(errorText(error, __('Could not load more versions.')))
  }
}

function actions(version: SheetVersion): DropdownOptions {
  const items = []
  if (props.writable)
    items.push({
      label: version.label ? __('Rename') : __('Name this version'),
      icon: 'lucide-pencil',
      onClick: () => emit('rename', version),
    })
  if (props.canCopy)
    items.push({
      label: __('Make a copy'),
      icon: 'lucide-copy',
      onClick: () => emit('copy', version),
    })
  if (props.writable)
    items.push({
      label: __('Restore this version'),
      icon: 'lucide-undo-2',
      onClick: () => emit('restore', version),
    })
  return items
}

function rowClass(version: SheetVersion) {
  return props.previewed === version.seq ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2'
}

// The panel remounts with the editor when a preview opens: it comes back where it was.
onMounted(async () => {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = props.list.scrollTop.value
})
</script>

<template>
  <aside
    class="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-outline-gray-2 bg-surface-base text-ink-gray-8 shadow-xl"
    :aria-label="__('Versions')"
    @click.stop
    @keydown.stop
  >
    <header
      class="flex min-h-12 shrink-0 items-center justify-between border-b border-outline-gray-1 pl-4 pr-2"
    >
      <h2 class="text-lg-semibold">{{ __('Versions') }}</h2>
      <div class="flex items-center gap-1">
        <Button
          v-if="writable && !previewed"
          size="sm"
          :label="__('Save version')"
          icon-left="lucide-bookmark"
          @click="saveVersion"
        />
        <Button
          icon="lucide-x"
          variant="ghost"
          :aria-label="__('Close versions')"
          @click="emit('close')"
        />
      </div>
    </header>

    <div
      ref="scroller"
      class="min-h-0 flex-1 overflow-y-auto pb-10"
      @scroll="list.rememberScroll(($event.target as HTMLElement).scrollTop)"
    >
      <div v-if="list.loading.value" class="space-y-3 p-4" aria-hidden="true">
        <Skeleton v-for="row in 4" :key="row" class="h-12 w-full rounded-4" />
      </div>
      <div v-else-if="list.loadError.value" class="px-4 py-10 text-center" role="alert">
        <p class="text-p-sm text-ink-gray-7">{{ __('Versions could not be loaded.') }}</p>
        <p class="mt-1.5 text-p-sm text-ink-gray-5">{{ list.loadError.value }}</p>
        <Button
          class="mt-4"
          :label="__('Retry')"
          icon-left="lucide-refresh-cw"
          @click="list.retry"
        />
      </div>
      <div v-else-if="!list.versions.value.length" class="px-4 py-10 text-center">
        <p class="text-p-sm text-ink-gray-7">{{ __('No versions yet.') }}</p>
        <p class="mt-1.5 text-p-sm text-ink-gray-5">
          {{ __('Save a version to keep this state of the spreadsheet.') }}
        </p>
      </div>
      <ul v-else class="space-y-0.5 p-2">
        <li>
          <button
            type="button"
            class="w-full rounded-4 px-2 py-2.5 text-left text-base text-ink-gray-8"
            :class="previewed ? 'hover:bg-surface-gray-2' : 'bg-surface-gray-3'"
            :aria-pressed="!previewed"
            @click="emit('preview', null)"
          >
            {{ __('Current version') }}
          </button>
        </li>
        <li
          v-for="version in list.versions.value"
          :key="version.seq"
          class="group flex items-center gap-1 rounded-4 pr-1"
          :class="rowClass(version)"
        >
          <button
            type="button"
            class="min-w-0 flex-1 px-2 py-2 text-left"
            :aria-pressed="previewed === version.seq"
            @click="emit('preview', version)"
          >
            <span class="flex items-center gap-2">
              <span class="truncate text-base text-ink-gray-8">{{ versionTitle(version) }}</span>
              <Badge
                v-if="version.pinned"
                :label="__('Pinned')"
                theme="gray"
                variant="subtle"
                size="sm"
              />
            </span>
            <span class="mt-1 block truncate text-sm text-ink-gray-5">
              {{ versionByline(version) }}
            </span>
          </button>
          <Dropdown v-if="actions(version).length" :options="actions(version)" align="end">
            <Button
              icon="lucide-ellipsis"
              variant="ghost"
              size="sm"
              :aria-label="__('More version actions')"
            />
          </Dropdown>
        </li>
      </ul>
      <div v-if="list.nextCursor.value" class="p-4">
        <Button
          class="w-full"
          :label="__('Load more')"
          :loading="list.loadingMore.value"
          @click="loadMore"
        />
      </div>
    </div>
  </aside>
</template>
