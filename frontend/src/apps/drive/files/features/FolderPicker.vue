<template>
  <Dialog v-model:open="open" :title="mode === 'move' ? 'Move to' : 'Make a copy'" size="lg">
    <div class="space-y-3">
      <TabButtons v-if="rootOptions.length > 1" v-model="rootKind" :options="rootOptions" fluid />
      <Button
        v-if="trail.length > 1"
        variant="ghost"
        icon-left="lucide-arrow-left"
        :label="trail.at(-2)?.title"
        @click="trail.pop()"
      />
      <div class="min-h-56 rounded-5 border border-outline-gray-1">
        <div v-if="folders.status === 'pending'" class="space-y-2 p-3">
          <Skeleton v-for="index in 4" :key="index" class="h-9 w-full" />
        </div>
        <ErrorMessage v-else-if="folders.error && !folders.rows.length" :message="folders.error?.message" class="p-3" />
        <div v-else class="divide-y divide-outline-gray-1">
          <Button
            v-for="folder in folders.rows"
            :key="folder.name"
            variant="ghost"
            icon-left="lucide-folder"
            icon-right="lucide-chevron-right"
            :label="folder.title"
            class="h-11 w-full justify-start rounded-none px-3 text-start"
            @click="trail.push({ node: folder.name, title: folder.title, access: folder.access })"
          />
          <Button
            v-if="folders.hasNext"
            class="m-2"
            label="Load more folders"
            :loading="folders.isFetchingNext"
            @click="folders.fetchNext()"
          />
        </div>
      </div>
      <p v-if="!canSelect" class="text-p-sm text-ink-gray-5">You cannot add files to this folder.</p>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" @click="open = false" />
        <Button
          variant="solid"
          theme="gray"
          :label="mode === 'move' ? 'Move' : 'Copy'"
          :disabled="!canSelect"
          @click="choose"
        />
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dialog, ErrorMessage, Skeleton, TabButtons } from 'frappe-ui'

import { children, node } from '@/apps/drive/client/nodes'
import { roots } from '@/apps/drive/client/roots'
import { DRIVE_ROLES, type DriveAccess } from '@/apps/drive/client/types'
import { useQuery } from '@/platform/server-state'

const props = defineProps<{ mode: 'move' | 'copy' }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [node: string] }>()
const discovered = useQuery(roots())
const rootKind = ref<'personal' | 'organization'>('personal')
const trail = ref<Array<{ node: string; title: string; access?: DriveAccess }>>([])
const rootOptions = computed(() => [
  { value: 'personal', label: 'My files' },
  ...(discovered.data?.organization ? [{ value: 'organization', label: 'Organization files' }] : []),
])
const root = computed(() => discovered.data?.[rootKind.value] ?? null)

watch([root, open], ([location, isOpen]) => {
  if (isOpen && location) trail.value = [{ ...location }]
}, { immediate: true })

const current = computed(() => trail.value.at(-1) ?? null)
const folders = useQuery(() => current.value
  ? children({ node: current.value.node, kind: 'folder', expand: 'access', order_by: 'title', ascending: true })
  : false)
const currentDetail = useQuery(() => current.value ? node(current.value.node, 'access') : false)
const canSelect = computed(() => (currentDetail.data?.access?.role ?? current.value?.access?.role ?? 0) >= DRIVE_ROLES.upload)

function choose() {
  if (!current.value || !canSelect.value) return
  emit('choose', current.value.node)
}
</script>
