<template>
  <Dialog v-model:open="open" size="lg" @close="dialogType = ''">
    <template #default>
      <div>
        <div class="text-xl-semibold flex text-nowrap overflow-hidden pr-8 mb-4">
          <template v-if="props.entities.length > 1">
            Moving {{ props.entities.length }} items
          </template>
          <template v-else>
            Moving "
            <div class="truncate max-w-[80%]">
              {{ props.entities[0].file_name }}
            </div>
            "
          </template>
        </div>
        <Tabs v-model="activeTab" :tabs="tabs">
          <template #tab-panel>
            <div class="px-1 py-1 h-64 overflow-auto flex flex-col">
              <Tree v-if="tree.children.length" :nodes="tree.children" node-key="value" guides="none">
                <template #item="{ node, expanded, hasChildren, toggle }">
                  <div class="group grow min-w-0 flex items-center gap-2 rounded-4 px-1 -mx-1"
                    :class="entities[0].folder === node.value
                      ? 'cursor-not-allowed'
                      : 'cursor-pointer hover:bg-surface-gray-2'"
                    @click.stop="openEntity(node)">
                    <button v-if="hasChildren" class="flex shrink-0 text-ink-gray-5 hover:text-ink-gray-8"
                      @click.stop="
                        () => {
                          if (!expanded)
                            node.children.forEach((k) =>
                              fetchFolderContents(k, { entity_name: k.value }, true),
                            )
                          toggle()
                        }
                      ">
                      <LucideChevronDown v-if="expanded" class="size-3.5" />
                      <LucideChevronRight v-else class="size-3.5" />
                    </button>
                    <span v-else class="w-3.5 shrink-0" />
                    <LucideFolder class="size-4 shrink-0 text-ink-gray-5" />
                    <div v-if="node.value === null" class="grow">
                      <Input v-model="node.label" autofocus type="text" input-class="!h-6" @click.stop
                        @keydown.enter="openEntity(node)" />
                    </div>
                    <span v-else class="grow truncate text-base"
                      :class="selected === node.value ? 'font-medium text-ink-gray-9' : 'text-ink-gray-8'">{{
                        node.label }}<span v-if="entities[0].folder === node.value" class="text-ink-gray-5 font-normal">
                        (current)</span></span>
                    <Button v-if="entities[0].folder !== node.value"
                      class="shrink-0 opacity-0 group-hover:opacity-100" variant="ghost" @click.stop="
                        () => {
                          node.children.push({
                            parent: node.value,
                            value: null,
                            label: 'New folder',
                          })
                          if (!expanded) toggle()
                        }
                      ">
                      <template #icon><LucideFolderPlus class="size-4" /></template>
                    </Button>
                    <LucideCheck v-if="selected === node.value" class="shrink-0 size-4 text-ink-gray-6" />
                  </div>
                </template>
              </Tree>
              <div v-if="tree.loading" class="space-y-1 py-1">
                <div v-for="i in 4" :key="i" class="flex items-center gap-1.5 h-7 px-1">
                  <Skeleton class="size-3.5 rounded-4 shrink-0" />
                  <Skeleton class="size-4 rounded-4 shrink-0" />
                  <Skeleton class="h-3 rounded-4" :style="{ width: folderWidths[(i - 1) % folderWidths.length] }" />
                </div>
              </div>
              <div v-else-if="!tree.children.length" class="flex justify-center flex-1">
                <div class="self-center text-sm text-ink-gray-6 flex flex-col gap-2">
                  <LucideFolderClosed class="size-5 self-center" />
                  No folders found
                </div>
              </div>
            </div>
          </template>
        </Tabs>
        <div class="flex items-center justify-between border-t border-outline-gray-1 pt-4">
          <div class="flex items-center my-auto justify-start">
            <p class="text-sm text-ink-gray-5 pr-1 shrink-0">Moving to:</p>
            <Dropdown v-if="dropDownBreadcrumbs.length" class="h-7" :options="dropDownBreadcrumbs">
              <Button variant="ghost">
                <LucideEllipsis class="size-3.5" />
              </Button>
            </Dropdown>
            <span v-if="dropDownBreadcrumbs.length" class="text-ink-gray-5 mx-0.5">
              {{ '/' }}
            </span>
            <div class="flex w-48 overflow-auto">
              <div v-for="(crumb, index) in slicedBreadcrumbs" :key="index" class="flex items-center">
                <span v-if="breadcrumbs.length > 1 && index > 0" class="text-ink-gray-5 mx-0.5">
                  {{ '/' }}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  :label="crumb.file_name"
                  :title="crumb.file_name"
                  class="truncate max-w-20"
                  :class="index === slicedBreadcrumbs.length - 1
                    ? 'text-ink-gray-9 font-medium'
                    : 'text-ink-gray-5'
                  "
                  @click="closeEntity(crumb.name)"
                />
              </div>
            </div>
          </div>
          <Button variant="solid" class="ml-auto" size="sm"
            :loading="move.loading" @click="moveFile">
            <template #prefix>
              <LucideArrowLeftRight class="size-4" />
            </template>
            Move
          </Button>
        </div>
      </div>
    </template>
  </Dialog>
</template>
<script setup>
import { watch, computed, h, ref, reactive } from 'vue'

import {
  createResource,
  Dialog,
  Button,
  Tabs,
  Dropdown,
  Tree,
   TextInput as Input,
  Skeleton,
  toast,
} from 'frappe-ui'
import { move, rootInfo } from '../js/resources'

import LucideBuilding2 from '~icons/lucide/building-2'
import LucideCheck from '~icons/lucide/check'
import LucideChevronDown from '~icons/lucide/chevron-down'
import LucideChevronRight from '~icons/lucide/chevron-right'
import LucideFolder from '~icons/lucide/folder'
import LucideFolderPlus from '~icons/lucide/folder-plus'
import LucideFolderClosed from '~icons/lucide/folder-closed'
import LucideHome from '~icons/lucide/home'
import LucideArrowLeftRight from '~icons/lucide/arrow-left-right'
import LucideEllipsis from '~icons/lucide/ellipsis'

const folderWidths = ['45%', '60%', '38%', '52%']

const props = defineProps({
  entities: {
    type: Object,
    required: false,
    default: null,
  },
})
const emit = defineEmits(['success', 'complete'])

const dialogType = defineModel()
const open = ref(true)

const activeTab = ref('home')
rootInfo.fetch()

// Reopen at the folder the user last moved into this session, so repeated moves
// to the same place don't start from root each time.
const LAST_MOVE_KEY = 'drive:last-move-dest'
function lastMoveParent() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LAST_MOVE_KEY) || 'null')
    if (!saved || typeof saved !== 'object') return ''
    return saved.parent || ''
  } catch {
    return ''
  }
}
const tree = reactive({
  name: '',
  label: 'Home',
  children: [],
  options: {
    isCollapsed: true,
  },
})

// State variables
const selected = ref('')
const breadcrumbs = ref([{ name: '', file_name: 'Home' }])

// iconLeft, not icon: `icon` makes an icon-only trigger and drops the label.
const tabs = computed(() => [
  { label: 'Home', value: 'home', iconLeft: h(LucideHome, { class: 'size-4' }) },
  { label: 'Site', value: 'site', iconLeft: h(LucideBuilding2, { class: 'size-4' }) },
])

const folderContents = createResource({
  url: 'suite.drive.api.list.files',
  makeParams: (params) => ({
    ...params,
    file_kinds: '["Folder"]',
  }),
})

const fetchFolderContents = (tree, params = {}, nested = false) => {
  folderContents.fetch(params, {
    onSuccess: (data) => {
      tree.children = []
      data.forEach((item) => {
        const node = reactive({
          ...item,
          label: item.file_name,
          value: item.name,
          children: [],
          expanded: false,
        })
        tree.children.push(node)
        if (!nested)
          fetchFolderContents(
            node,
            { ...params, entity_name: node.value },
            true,
          )
      })
      tree.loading = false
    },
  })
}

const selectedPerms = createResource({
  url: 'suite.drive.api.permissions.get_entity_with_permissions',
  makeParams: () => ({
    entity_name: selected.value,
  }),
  onSuccess: (data) => {
    breadcrumbs.value = data.breadcrumbs.map((k) => ({
      ...k,
      file_name: k.name === rootInfo.data?.home ? 'Home' : k.file_name,
    }))
  },
  onError: () => {
    // Remembered folder is gone or inaccessible — fall back to the root.
    selected.value = ''
    breadcrumbs.value = [{ name: '', file_name: 'Home' }]
  },
})

watch(
  activeTab,
  (newValue) => {
    selected.value = ''
    tree.loading = true
    tree.children = []
    if (newValue === 'home') {
      breadcrumbs.value = [{ name: '', file_name: 'Home' }]
      fetchFolderContents(tree)
    } else {
      breadcrumbs.value = [{ name: '', file_name: 'Site' }]
      fetchFolderContents(tree, { entity_name: rootInfo.data?.root })
    }
    // Re-applied on every tab switch, which resets `selected` above.
    const remembered = lastMoveParent()
    if (remembered) {
      selected.value = remembered
      selectedPerms.fetch()
    }
  },
  { immediate: true },
)

// Breadcrumb logic
const slicedBreadcrumbs = computed(() => {
  if (breadcrumbs.value.length > 3) {
    return breadcrumbs.value.slice(-3)
  }
  return breadcrumbs.value
})

const dropDownBreadcrumbs = computed(() => {
  const allExceptLastTwo = breadcrumbs.value.slice(0, -3)
  return allExceptLastTwo.map((item) => {
    return {
      ...item,
      icon: null,
      label: item.file_name,
      onClick: () => closeEntity(item.name),
    }
  })
})

// New folder logic
const createdNode = ref(null)
const createFolder = createResource({
  url: 'suite.drive.api.files.create_folder',
  makeParams(params) {
    return params
  },
  validate(params) {
    if (!params?.file_name) return false
  },
  onSuccess(data) {
    createdNode.value.value = data.name
    createdNode.value.children = []
    selected.value = data.name
    selectedPerms.fetch()
    createdNode.value = null
  },
  onError() {
    toast.error('There is already a folder with this name here.')
  },
})

// Selection logic
function openEntity(node) {
  if (props.entities[0].folder === node.value) return
  if (!node.value) {
    createdNode.value = node
    createFolder.fetch({
      file_name: node.label,
      parent: node.parent,
    })
  } else {
    selected.value = node.value
    selectedPerms.fetch({
      entity_name: selected.value,
    })
  }
}

function closeEntity(name) {
  const index = breadcrumbs.value.findIndex((obj) => obj.name === name)
  if (breadcrumbs.value.length > 1 && index !== breadcrumbs.value.length - 1) {
    breadcrumbs.value = breadcrumbs.value.slice(0, index + 1)
    selected.value = breadcrumbs.value[breadcrumbs.value.length - 1].name
    folderContents.fetch({
      entity_name: selected.value,
    })
  }
}

const moveFile = async () => {
  emit('success')
  await move.submit({
    entity_names: props.entities.map((obj) => obj.name),
    new_parent: selected.value,
  })
  try {
    sessionStorage.setItem(
      LAST_MOVE_KEY,
      JSON.stringify({ parent: selected.value }),
    )
  } catch {
    // sessionStorage unavailable — non-fatal.
  }
  open.value = false
  emit('complete')
}
</script>
