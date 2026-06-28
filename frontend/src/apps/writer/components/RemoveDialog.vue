<template>
  <Dialog v-model:open="open" v-bind="dialogOptions" @close="dialogType = ''">
    <div class="flex items-center justify-start">
        <div class="text-base text-ink-gray-6">
          <template v-if="props.entities.length">
            {{ props.entities.length > 1 ? 'These items ' : `"${props.entities[0].file_name}" ` }}
          </template>
          <span v-html="dialogData.message" />
        </div>
      </div>
      <ErrorMessage class="my-1 text-center" :message="updateResource.error" />
  </Dialog>
</template>
<script setup>
import { ref, computed } from 'vue'
import { createResource, Dialog, ErrorMessage, toast } from 'frappe-ui'

import LucideRotateCcw from '~icons/lucide/rotate-ccw'

const props = defineProps({
  entities: {
    type: Array,
    required: true,
  },
})
const emit = defineEmits(['success'])
const dialogType = defineModel()
const open = ref(true)

const dialogData = computed(() => {
  const itemString = props.entities.length === 1 ? 'an item' : `${props.entities.length} items`
  const MAP = {
    restore: {
      title: `Restore ${itemString}`,
      message: `will be restored to ${
        props.entities.length === 1 ? 'its original location' : 'their original locations'
      }.`,
      url: 'suite.drive.api.files.remove_or_restore',
      button: {
        variant: 'solid',
        label: 'Restore',
        iconLeft: LucideRotateCcw,
      },
      toastMessage: `Restored ${itemString}.`,
    },
    remove: {
      title: `Move ${itemString} to Trash`,
      message:
        'will be moved to Trash.<br/><br/> Items in trash are deleted forever after 30 days.',
      url: 'suite.drive.api.files.remove_or_restore',
      button: {
        label: 'Move to Trash',
        theme: 'red',
        variant: 'subtle',
      },
      toastMessage: `Moved ${itemString} to Trash.`,
    },
  }
  return MAP[dialogType.value]
})

const loading = computed(() => (dialogData.value.resource || updateResource).loading)
const dialogOptions = computed(() => {
  return {
    title: dialogData.value.title,
    size: 'sm',
    actions: [
      {
        onClick: async () => {
          if (dialogData.value.resource) {
            open.value = false
            await dialogData.value.resource.submit()
            emit('success')
          } else updateResource.submit()
        },
        ...dialogData.value.button,
        disabled: loading.value,
        // loading: loading.value,
      },
    ],
  }
})

const updateResource = createResource({
  url: dialogData.value.url,
  makeParams: () => {
    open.value = ''
    return {
      entity_names:
        typeof props.entities === 'string'
          ? JSON.stringify([props.entities])
          : JSON.stringify(props.entities.map((entity) => entity.name)),
    }
  },
  onSuccess(data) {
    emit('success', data)
    updateResource.reset()
    if (dialogData.value.onSuccess) dialogData.value.onSuccess(props.entities, data)
    toast.success(dialogData.value.toastMessage)
  },
})
</script>
