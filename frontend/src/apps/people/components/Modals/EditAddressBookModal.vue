<template>
  <Dialog v-model:open="show" v-bind="options">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="addressBook.name"
          :label="__('Name')"
          :placeholder="__('Work Contacts')"
        />
        <FormControl
          v-model="addressBook.description"
          type="textarea"
          :label="__('Description')"
          :placeholder="__('All my work-related contacts')"
        />
        <FormControl
          v-model="addressBook.isDefault"
          type="checkbox"
          :label="__('Set as Default')"
          :disabled="isDefault"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

const show = defineModel<boolean>()

const { name, description, isDefault, save } = defineProps<{
  name: string
  description?: string | null
  isDefault: boolean
  save: (value: { name: string; description: string; isDefault: boolean }) => Promise<void>
}>()

const addressBook = reactive({ name, description: description ?? '', isDefault })

const options = computed(() => ({
  title: __('Edit General Information'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled:
        addressBook.name === name &&
        addressBook.description === description &&
        addressBook.isDefault === isDefault,
      onClick: async () => {
        try {
          await save({ ...addressBook })
          show.value = false
        } catch {
          /* The command reports the refusal. Keep the draft open. */
        }
      },
    },
  ],
}))

watch(show, (val) => {
  if (val) Object.assign(addressBook, { name, description: description ?? '', isDefault })
})
</script>
