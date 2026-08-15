<!-- PROTOTYPE — remove. Fake Files list page. -->
<template>
  <PageHeader>
    <Breadcrumbs :items="[{ label: 'Files', route: areaTo('files') }]" />
    <NewMenu />
  </PageHeader>

  <div class="px-5 py-4">
    <List :columns="['minmax(0,1fr)', '10rem', '10rem']">
      <ListHeader>
        <ListHeaderCell>Name</ListHeaderCell>
        <ListHeaderCell>Owner</ListHeaderCell>
        <ListHeaderCell>Modified</ListHeaderCell>
      </ListHeader>
      <ListRows :items="FILES" row-key="id">
        <template #default="{ item: file }">
        <ListRow :value="file.id" @click="() => {}">
          <ListCell>
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="size-4 shrink-0"
                :class="fileIcon(file)"
                aria-hidden="true"
              />
              <span class="truncate text-base text-ink-gray-8">{{ file.name }}</span>
            </span>
          </ListCell>
          <ListCell>
            <span class="flex items-center gap-2">
              <Avatar size="xs" :label="file.owner" />
              <span class="text-base text-ink-gray-7">{{ file.owner }}</span>
            </span>
          </ListCell>
          <ListCell>
            <span class="text-base text-ink-gray-5">{{ file.modified }}</span>
          </ListCell>
        </ListRow>
        </template>
      </ListRows>
    </List>
  </div>
</template>

<script setup lang="ts">
import { Avatar, Breadcrumbs, PageHeader } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'

import { DOC_KIND_META, FILES, type FileRow } from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
import { useShellNav } from '../useShellNav'

const { areaTo } = useShellNav()

function fileIcon(file: FileRow) {
  if (file.kind === 'folder') return 'lucide-folder text-ink-gray-5'
  const meta = DOC_KIND_META[file.kind]
  return `${meta.icon} ${meta.tint}`
}
</script>
