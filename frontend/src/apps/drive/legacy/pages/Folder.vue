<template>
  <GenericPage
    :verify="folder"
    :get-entities="getFolderContents"
    :empty="{
      icon: LucideFolderClosed,
      title: 'Nothing here',
      description: 'Add files to this folder.',
    }"
  />
</template>

<script setup>
import GenericPage from '@/apps/drive/components/GenericPage.vue'
import { watch, computed, onUnmounted } from 'vue'
import { createResource } from 'frappe-ui'
import { appDocumentTitle } from '@/utils/documentTitle'
import { COMMON_OPTIONS } from '@/apps/drive/resources/files'
import { prettyData, setCache, updateURLSlug } from '@/apps/drive/utils/files'
import { setCrumbEntity, clearCrumbEntity } from '@/apps/drive/data/breadcrumbs'
import { setCurrentFolder } from '@/apps/drive/data/currentFolder'
import router from '@/apps/drive/router'
import LucideFolderClosed from '~icons/lucide/folder-closed'

const props = defineProps({
  entityName: String,
  slug: String,
})
watch(
  () => props.entityName,
  (name) => setCurrentFolder({ name: name || '' }),
  { immediate: true },
)

const getFolderContents = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.files',
  makeParams: (params) => ({
    ...params,
    entity_name: props.entityName,
  }),
  cache: ['folder', props.entityName],
})
getFolderContents.paginated = true
setCache(getFolderContents, ['folder', props.entityName])

const onSuccess = (entity) => {
  if (router.currentRoute.value.params.entityName !== entity.name) return
  document.title = appDocumentTitle(entity.file_name, 'Drive')
  setCrumbEntity(entity)
  updateURLSlug(entity.file_name)
}
onUnmounted(() => clearCrumbEntity(props.entityName))

const entityName = computed(() => props.entityName)
/** Permissions + metadata for the folder in the URL — not global state. */
const folder = createResource({
  url: 'suite.drive.api.permissions.get_entity_with_permissions',
  transform(entity) {
    return prettyData([entity])[0]
  },
  onSuccess,
})
watch(entityName, (v) => folder.fetch({ entity_name: v }), { immediate: true })
</script>
