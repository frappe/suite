<!-- PROTOTYPE — remove. Fake Files list, filtered by the sidebar folder. -->
<template>
  <PageHeader>
    <Breadcrumbs :items="crumbs" />
    <NewMenu />
  </PageHeader>

  <div class="px-5 py-4">
    <!-- list-row-px-3 puts the column header, the group headers and the rows on
         one content inset, so nothing drifts against the row hover surface. -->
    <List
      :columns="['minmax(0,1fr)', '12rem', '8rem']"
      :row-height="40"
      class="list-row-px-3"
    >
      <ListHeader>
        <ListHeaderCell>Name</ListHeaderCell>
        <ListHeaderCell>Owner</ListHeaderCell>
        <ListHeaderCell>Modified</ListHeaderCell>
      </ListHeader>

      <ListGroup
        v-for="group in groups"
        :key="group.label"
        :label="group.label"
      >
        <ListRow
          v-for="file in group.files"
          :key="file.id"
          :value="file.id"
          @click="() => {}"
        >
          <ListCell>
            <span
              class="mr-2 size-4 shrink-0"
              :class="fileIcon(file)"
              aria-hidden="true"
            />
            <span class="truncate text-base text-ink-gray-8">{{ file.name }}</span>
            <span
              v-if="file.starred"
              class="lucide-star ml-1.5 size-3.5 shrink-0 text-ink-amber-5"
              aria-hidden="true"
            />
          </ListCell>
          <ListCell>
            <Avatar
              size="xs"
              :label="file.owner"
              :image="PEOPLE[file.owner]"
              class="mr-2 shrink-0"
            />
            <span class="truncate text-base text-ink-gray-7">{{ file.owner }}</span>
          </ListCell>
          <ListCell>
            <span class="truncate text-base text-ink-gray-5">{{ file.modified }}</span>
          </ListCell>
        </ListRow>
      </ListGroup>

      <div
        v-if="!files.length"
        class="flex flex-col items-center justify-center gap-2 py-16"
      >
        <span class="lucide-folder-open size-6 text-ink-gray-4" aria-hidden="true" />
        <span class="text-base text-ink-gray-5">
          Nothing in {{ folderLabel.toLowerCase() }}
        </span>
      </div>
    </List>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Avatar, Breadcrumbs, PageHeader } from 'frappe-ui'
import { List, ListCell, ListGroup, ListHeader, ListHeaderCell, ListRow } from 'frappe-ui/list'

import { DOC_KIND_META, FOLDERS, PEOPLE, filesInFolder, type FileRow } from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
import { useShellNav } from '../useShellNav'

const { folder, areaTo } = useShellNav()

const folderLabel = computed(
  () => FOLDERS.find((item) => item.id === folder.value)?.label ?? 'All files',
)

const crumbs = computed(() => {
  const root = { label: 'Files', route: areaTo('files') }
  if (folder.value === 'all') return [root]
  return [root, { label: folderLabel.value, route: areaTo('files', folder.value) }]
})

const files = computed(() => filesInFolder(folder.value))

// Folders before documents, the order a file browser is read in. Empty groups
// drop out so a filtered view never shows a bare heading.
const groups = computed(() =>
  [
    { label: 'Folders', files: files.value.filter((file) => file.kind === 'folder') },
    { label: 'Files', files: files.value.filter((file) => file.kind !== 'folder') },
  ].filter((group) => group.files.length),
)

function fileIcon(file: FileRow) {
  if (file.kind === 'folder') return 'lucide-folder text-ink-gray-5'
  const meta = DOC_KIND_META[file.kind]
  return `${meta.icon} ${meta.tint}`
}
</script>
