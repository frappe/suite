<template>
  <NewFolderDialog
    v-if="dialog === 'f'"
    v-model="dialog"
    :parent="folderParent"
    @success="(data) => addToList(data, 'Folder')"
  />
  <NewLinkDialog
    v-else-if="dialog === 'l'"
    v-model="dialog"
    :parent="folderParent"
    @success="(data) => addToList(data, 'Link')"
  />

  <ShareDialog
    v-else-if="dialog === 's'"
    v-model="dialog"
    :file="entities[0]"
    @success="() => props.list?.fetch?.(props.list.params)"
  />
  <MoveDialog
    v-else-if="dialog === 'm'"
    v-model="dialog"
    :entities="entities"
    @success="removeFromList(entities)"
  />
  <InfoDialog
    v-else-if="dialog === 'i'"
    v-model="dialog"
    :entity="entities[0]"
  />
</template>

<script setup>
import { computed } from 'vue'
import { useTimeAgo } from '@vueuse/core'
import { useRoute } from 'vue-router'

import NewFolderDialog from '@/apps/drive/components/NewFolderDialog.vue'
import NewLinkDialog from '@/apps/drive/components/NewLinkDialog.vue'
import { ShareDialog, MoveDialog, InfoDialog } from '@/apps/drive/ui/drive'

const props = defineProps({
  list: Object,
  entities: {
    type: Array,
    default: () => [],
  },
  parent: {
    type: String,
    default: '',
  },
})

const dialog = defineModel(String)
const route = useRoute()

const folderParent = computed(
  () => props.parent ?? route.params.entityName ?? '',
)

const resetDialog = () => (dialog.value = '')

function addToList(data, file_type) {
  resetDialog()
  if (!props.list) return
  const now = Date()
  data = {
    ...data,
    modified: now,
    file_type,
    share_count: 0,
    read: 1,
    write: 1,
    share: 1,
    comment: 1,
    relativeModified: useTimeAgo(now),
  }
  props.list.data.push(data)
}

function removeFromList(entities) {
  resetDialog()
  if (!props.list) return
  const names = entities.map((o) => o.name)
  props.list.setData(
    props.list.data.filter(({ name }) => !names.includes(name)),
  )
}
</script>
