<template>
  <Dialog v-model:open="open" title="New from template" size="2xl">
    <form class="space-y-4" @submit.prevent="create">
      <TabButtons v-if="typeOptions.length > 1" v-model="typeKey" :options="typeOptions" />
      <div class="h-72 overflow-y-auto rounded-5 border border-outline-gray-1 p-3">
        <div
          v-if="templates.status === 'pending' && !templates.rows.length"
          class="grid grid-cols-3 gap-3"
        >
          <Skeleton v-for="index in 6" :key="index" class="h-30 w-full rounded-5" />
        </div>
        <div
          v-else-if="templates.error && !templates.rows.length"
          class="flex h-full flex-col items-center justify-center gap-3 text-center"
        >
          <ErrorMessage :message="templates.error.message" />
          <Button label="Retry" :loading="templates.isFetching" @click="templates.refetch()" />
        </div>
        <div
          v-else-if="!templates.rows.length"
          class="flex h-full flex-col items-center justify-center gap-3 text-center"
        >
          <div class="rounded-full bg-surface-gray-2 p-3 text-ink-gray-5">
            <span class="lucide-layout-template size-6" aria-hidden="true" />
          </div>
          <p class="text-base text-ink-gray-7">No templates yet</p>
          <p class="text-sm text-ink-gray-5">Templates for this type will appear here.</p>
        </div>
        <template v-else>
          <div class="grid grid-cols-3 gap-3" role="listbox" aria-label="Templates">
            <button
              v-for="row in templates.rows"
              :key="row.name"
              type="button"
              role="option"
              :aria-selected="selected?.name === row.name"
              class="flex min-w-0 flex-col items-start gap-2 rounded-5 border p-2 text-start transition-colors focus-visible:focus-ring"
              :class="
                selected?.name === row.name
                  ? 'border-outline-gray-3 bg-surface-gray-2'
                  : 'border-outline-gray-1 bg-surface-base hover:bg-surface-gray-1'
              "
              @click="choose(row)"
              @dblclick="chooseAndCreate(row)"
            >
              <span
                class="flex h-20 w-full items-center justify-center overflow-hidden rounded-4 bg-surface-gray-1"
              >
                <img
                  v-if="row.preview?.url && !failedPreviews.has(row.name)"
                  :src="row.preview.url"
                  alt=""
                  class="size-full object-cover"
                  @error="failedPreviews.add(row.name)"
                />
                <span
                  v-else
                  class="size-6"
                  :class="[nodeIcon(row), nodeIconTint(row)]"
                  aria-hidden="true"
                />
              </span>
              <span class="w-full truncate text-base text-ink-gray-8">{{ row.title }}</span>
            </button>
          </div>
          <div v-if="templates.hasNext" class="flex justify-center pt-3">
            <Button
              label="Load more"
              :loading="templates.isFetchingNext"
              @click="templates.fetchNext()"
            />
          </div>
        </template>
      </div>
      <FormControl v-model="title" label="Name" required :disabled="!selected" />
      <div class="flex justify-end gap-2">
        <Button label="Cancel" @click="open = false" />
        <Button
          type="submit"
          variant="solid"
          theme="gray"
          label="Create"
          :disabled="!selected || !title.trim()"
          :loading="copy.isPending"
        />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, ErrorMessage, FormControl, Skeleton, TabButtons } from 'frappe-ui'
import { computed, inject, reactive, ref, watch } from 'vue'

import { copyNode } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { view } from '@/apps/drive/client/views'
import { DOCUMENT_TYPES_KEY } from '@/platform/contracts'
import { useMutation, useQuery } from '@/platform/server-state'

import { nodeIcon, nodeIconTint } from '../internal/icons'

/**
 * New from template (spec §5.12): one tab per registered document type, the
 * readable templates of that type, and a Name. Create copies the template into
 * `parent`. The server keeps its own title on a conflict.
 */
const props = defineProps<{ parent: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [node: DriveNode] }>()

const documentTypes = inject(DOCUMENT_TYPES_KEY, [])
const typeOptions = computed(() =>
  documentTypes.map((definition) => ({ value: definition.key, label: definition.newLabel() })),
)
const typeKey = ref(documentTypes[0]?.key ?? '')
const contentDoctype = computed(
  () => documentTypes.find((definition) => definition.key === typeKey.value)?.contentDoctype,
)
const templates = useQuery(() =>
  open.value && contentDoctype.value
    ? view({ view: 'templates', content_doctype: contentDoctype.value, expand: 'preview' })
    : false,
)
const selected = ref<DriveNode | null>(null)
const title = ref('')
const failedPreviews = reactive(new Set<string>())
const copy = useMutation(copyNode())

watch([typeKey, open], () => {
  selected.value = null
  title.value = ''
})

function choose(row: DriveNode) {
  selected.value = row
  title.value = row.title
}

function chooseAndCreate(row: DriveNode) {
  choose(row)
  create()
}

async function create() {
  const template = selected.value
  const name = title.value.trim()
  if (!template || !name || copy.isPending) return
  const created = await copy.run({ node: template.name, parent_node: props.parent, title: name })
  // The platform reports a failed copy; the picker stays open for another try.
  if (!created) return
  open.value = false
  emit('created', created)
}
</script>
