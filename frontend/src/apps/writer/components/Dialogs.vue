<template>
  <!-- Mutation dialogs -->
  <ShareDialog v-if="dialog === 's'" v-model="dialog" :add-users="params || []" :file="entity" @success="() => resource.fetch()" />
  <MoveDialog v-else-if="dialog === 'm'" v-model="dialog" :entities @complete="refresh" />
  
  <!-- Confirmation dialogs -->
  <RemoveDialog v-if="dialog === 'remove'" v-model="dialog" :entities @success="$router.push({ name: 'writer-home' })" />
  
  <InfoDialog v-else-if="dialog === 'i'" v-model="dialog" :entity :emitter />
  <SearchDialog v-if="dialog === 'search'" v-model="dialog" />
</template>
<script setup>
import { ref, watch, computed } from 'vue'
import emitter from '@/apps/writer/emitter'

import { ShareDialog, MoveDialog, InfoDialog } from '@/apps/drive/legacy/sdk'
import { startRename } from '@/apps/drive/legacy/data/selection'
import RemoveDialog from './RemoveDialog.vue'
import SearchDialog from './SearchDialog.vue'

import { onKeyDown } from '@vueuse/core'

const props = defineProps({
  docs: Array,
})


const resource = computed(() => props.docs?.[0])
const entities = computed(() => props.docs?.map(r => r.doc) ?? [])
const entity = computed(() => entities.value?.[0])
const dialog = defineModel(String)
const params = ref(null)
const open = ref(false)
watch(dialog, (val) => {
  if (val) open.value = true
})

const refresh = () => {
  dialog.value = ''
  resource.value.fetch()
}

emitter.on('share', (data) => {
  params.value = data
  dialog.value = 's'
})
emitter.on('newFolder', () => (dialog.value = 'f'))
emitter.on('rename', () => entity.value && startRename(entity.value.name))
emitter.on('remove', () => (dialog.value = 'remove'))
emitter.on('move', () => (dialog.value = 'm'))
emitter.on('newLink', () => (dialog.value = 'l'))

onKeyDown('k', (e) => {
  if (e.metaKey && e.shiftKey) {
    e.preventDefault()
    dialog.value = 'search'
  }
})
</script>
