<template>
  <ShareDialog
    v-if="dialog === 's'"
    v-model="dialog"
    :file="entities[0]"
    @success="() => resource?.fetch?.(resource.params)"
  />
  <MoveDialog
    v-else-if="dialog === 'm'"
    v-model="dialog"
    :entities="entities"
    @complete="onMoveComplete"
  />
  <InfoDialog
    v-else-if="dialog === 'i'"
    v-model="dialog"
    :entity="entities[0]"
  />
</template>

<script setup>
import { computed } from 'vue'

import { ShareDialog, MoveDialog, InfoDialog } from '@/apps/drive/ui/drive'

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

function onMoveComplete() {
  if (entityOpen.value) props.resource?.fetch?.(props.resource.params)
  resetDialog()
}
</script>
