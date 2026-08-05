<template>
  <List
    class="pt-3 flex flex-col flex-1 min-h-0 list-row-px-5 sm:list-row-px-3"
    :columns="columnTracks"
    :row-height="40"
    divider="full"
  >
    <div class="flex-1 min-h-0 overflow-hidden px-0 sm:px-2">
      <ListRow v-for="i in 10" :key="i" class="pointer-events-none">
        <ListCell />
        <ListCell>
          <Skeleton class="h-[16px] w-[16px] shrink-0 mr-2 rounded-sm" />
          <Skeleton class="h-3.5 rounded" :style="{ width: nameWidths[i % nameWidths.length] }" />
        </ListCell>
        <ListCell class="hidden sm:flex">
          <Skeleton class="size-5 shrink-0 mr-2 rounded-full" />
          <Skeleton class="h-3 w-16 rounded" />
        </ListCell>
        <ListCell><Skeleton class="h-3 w-20 rounded" /></ListCell>
        <ListCell class="hidden sm:flex"><Skeleton class="h-3 w-12 rounded" /></ListCell>
        <ListCell />
      </ListRow>
    </div>
  </List>
</template>

<script setup>
import { List, ListRow, ListCell } from 'frappe-ui/list'
import { Skeleton } from 'frappe-ui'
import { useListColumns } from '@/apps/drive/data/listColumns'

const columnTracks = useListColumns()

const nameWidths = ['45%', '30%', '55%', '38%', '50%', '42%', '60%', '35%', '48%', '52%']
</script>
