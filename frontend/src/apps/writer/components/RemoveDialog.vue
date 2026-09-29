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
      <ErrorMessage class="my-1 text-center" :message="error" />
  </Dialog>
</template>
<script setup>
import { ref, computed } from 'vue'
import { Dialog, ErrorMessage, toast } from 'frappe-ui'

import { setNodeState } from '@/apps/writer/drive'

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
      state: 'Active',
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
      state: 'Trashed',
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

const loading = ref(false)
const error = ref(null)
const dialogOptions = computed(() => {
  return {
    title: dialogData.value.title,
    size: 'sm',
    actions: [
      {
        onClick: () => update(),
        ...dialogData.value.button,
        disabled: loading.value,
        // loading: loading.value,
      },
    ],
  }
})

async function update() {
  const names =
    typeof props.entities === 'string' ? [props.entities] : props.entities.map((entity) => entity.name)
  loading.value = true
  error.value = null
  try {
    for (const name of names) await setNodeState(name, dialogData.value.state)
    open.value = false
    emit('success')
    toast.success(dialogData.value.toastMessage)
  } catch (failure) {
    error.value = failure
  } finally {
    loading.value = false
  }
}
</script>
