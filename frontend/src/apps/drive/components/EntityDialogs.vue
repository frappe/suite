<template>
  <RenameDialog
    v-if="dialog === 'rn'"
    v-model="dialog"
    :entity="entities[0]"
    @success="
      ({ file_name }) => {
        if (resource?.data) resource.data.file_name = file_name
        resetDialog()
      }
    "
  />
  <ShareDialog
    v-else-if="dialog === 's'"
    v-model="dialog"
    :entity="entities[0]"
    @success="() => resource?.fetch?.(resource.params)"
  />
  <MoveDialog
    v-else-if="dialog === 'm'"
    v-model="dialog"
    :entities="entities"
    @success="onMoveSuccess"
    @complete="entityOpen && resource?.fetch?.(resource.params)"
  />
  <InfoDialog
    v-else-if="dialog === 'i'"
    v-model="dialog"
    :entity="entities[0]"
  />
  <ConfirmDialog
    v-if="dialog === 'remove'"
    v-model="dialog"
    :entities="entities"
    @success="onDeleteSuccess"
  />
</template>

<script setup>
import { computed } from 'vue'
import { setPageBreadcrumbs } from '@/apps/drive/data/breadcrumbs'
import { openEntity } from '@/apps/drive/utils/files'

import ConfirmDialog from '@/apps/drive/components/ConfirmDialog.vue'
import { ShareDialog, MoveDialog, RenameDialog, InfoDialog } from '@/apps/drive/ui/drive'

const props = defineProps({
  resource: Object,
  entities: {
    type: Array,
    default: () => [],
  },
})

const dialog = defineModel(String)

const entityOpen = computed(
  () =>
    props.resource?.data?.name &&
    props.entities[0]?.name === props.resource.data.name,
)

const resetDialog = () => (dialog.value = '')

function onMoveSuccess() {
  if (entityOpen.value) {
    setPageBreadcrumbs({ loading: true, name: props.resource.data.name })
  }
  resetDialog()
}

function onDeleteSuccess() {
  if (!entityOpen.value) {
    resetDialog()
    return
  }
  const data = props.resource?.data
  resetDialog()
  if (!data) return
  openEntity({
    is_folder: 1,
    name: data.folder,
    breadcrumbs: data.breadcrumbs?.slice(0, -1) ?? [],
  })
}
</script>
