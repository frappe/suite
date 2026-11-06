<template>
  <Dialog v-model:open="open" :title="TITLES[mode]" size="lg">
    <div class="flex flex-col gap-4">
      <p v-if="description" class="text-p-base text-ink-gray-7">{{ description }}</p>
      <DriveBrowser
        v-model:location="current"
        :active="open"
        :root
        :start-root="startingRoot"
        :start-folder="root ? null : startingFolder(items, folder)"
        type="folder"
        :can-open="(node) => canOpenFolder(mode, items, node)"
        :empty-label="__('No folders inside')"
        :list-label="(name) => __('Folders in {0}', [name])"
        :can-create-folder
      >
        <template #row="{ node, openFolder }">
          <button
            type="button"
            class="flex h-11 w-full items-center gap-2.5 rounded-4 px-2 text-start text-lg text-ink-gray-8 transition-colors hover:bg-surface-gray-2 active:bg-surface-gray-3 disabled:cursor-not-allowed disabled:text-ink-gray-4 disabled:hover:bg-transparent sm:h-9 sm:text-base"
            :disabled="!canOpenFolder(mode, items, node.name)"
            @click="openFolder(node)"
          >
            <span
              class="size-4 shrink-0"
              :class="[
                nodeIcon(node),
                canOpenFolder(mode, items, node.name) ? nodeIconTint(node) : 'text-ink-gray-4',
              ]"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate" :title="node.title">{{ node.title }}</span>
            <span
              v-if="!canOpenFolder(mode, items, node.name)"
              class="shrink-0 text-sm text-ink-gray-4"
            >
              Being moved
            </span>
            <span
              v-else
              class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4"
              aria-hidden="true"
            />
          </button>
        </template>
      </DriveBrowser>
      <div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-3">
        <p
          v-if="target.status === 'refused'"
          class="min-w-0 basis-full text-p-sm text-ink-gray-5 sm:flex-1 sm:basis-auto"
          role="status"
        >
          {{ target.reason }}
        </p>
        <Button label="Cancel" @click="open = false" />
        <Button
          variant="solid"
          theme="gray"
          :label="ACTIONS[mode]"
          :disabled="target.status !== 'allowed'"
          :loading="busy || checking"
          @click="choose"
        />
      </div>
    </div>
    <MoveAccessDialog
      v-model:open="reviewingAccess"
      :change="accessChange"
      @confirm="confirmMove"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, client, useQuery } from '@/api'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { nodeIcon, nodeIconTint } from '../internal/icons'
import DriveBrowser, { type BrowserLocation } from './DriveBrowser.vue'
import {
  canOpenFolder,
  destination,
  itemsRoot,
  moveAccessChange,
  startingFolder,
  type MoveAccessChange,
  type PickedItem,
  type PickerMode,
} from './folderPicker'
import MoveAccessDialog from './MoveAccessDialog.vue'
import { useWorkspaceName } from './useWorkspaceName'

const props = withDefaults(
  defineProps<{
    mode: PickerMode
    /** The items the action places. A folder being moved cannot be opened, and items cannot move to where they are. */
    items?: readonly PickedItem[]
    /** Keeps the picker inside one root: its node. A restore must stay in its root. */
    root?: string
    /** The folder the user is looking at. The picker opens there when the items are in different folders. */
    folder?: string
    description?: string
    /** The chosen action is running. */
    busy?: boolean
  }>(),
  { items: () => [] },
)
const TITLES = { move: 'Move to', copy: 'Make a copy', restore: 'Restore to' } as const
const ACTIONS = { move: 'Move here', copy: 'Copy here', restore: 'Restore here' } as const
const open = defineModel<boolean>('open', { required: true })
/** `title` is the folder's name as the picker shows it, for the message after the action. */
const emit = defineEmits<{ choose: [node: string, title: string] }>()
const discovered = useQuery(api.drive.roots.list, {})
// Each time it opens, the picker shows the root the items are in, whichever
// view they were picked from. A restore stays in its own root.
const startingRoot = computed(() =>
  discovered.data ? itemsRoot(props.items, discovered.data) : null,
)
const current = ref<BrowserLocation | null>(null)
const currentDetail = useQuery(api.drive.nodes.get, () =>
  current.value ? { node: current.value.node, expand: 'access' } : false,
)
/** The caller's role on the open folder: its fresh details, else what the listing said. */
const currentRole = computed(() => currentDetail.data?.access?.role ?? current.value?.access?.role)
const target = computed(() =>
  current.value
    ? destination(props.mode, props.items, current.value.node, currentRole.value)
    : { status: 'unknown' as const },
)

/** The items can go in a new folder here, which the picker then opens. */
const canCreateFolder = computed(() => (currentRole.value ?? 0) >= DRIVE_ROLES.upload)
/** The move preview is loading, before the confirmation or the move. */
const checking = ref(false)
const accessChange = ref<MoveAccessChange | null>(null)
const workspace = useWorkspaceName()
const reviewingAccess = ref(false)
let confirmMove = () => {}
async function choose() {
  if (!current.value || target.value.status !== 'allowed' || props.busy || checking.value) return
  const { node, label } = current.value
  accessChange.value = props.mode === 'move' ? await previewAccessChange(node) : null
  if (!accessChange.value) {
    emit('choose', node, label)
    return
  }
  confirmMove = () => emit('choose', node, label)
  reviewingAccess.value = true
}
/** A move that gives someone access, or lowers the mover's own role, asks first (unified frontend §5.7). */
async function previewAccessChange(folder: string): Promise<MoveAccessChange | null> {
  checking.value = true
  try {
    const previews = await Promise.all(
      props.items.map((item) =>
        client.query(api.drive.nodes.previewMove, { node: item.name, parent_node: folder }),
      ),
    )
    return moveAccessChange(previews, workspace.value)
  } finally {
    checking.value = false
  }
}
</script>
