<template>
  <Dialog v-model:open="show" v-bind="options">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="addressBook"
          type="combobox"
          :label="__('Address Book')"
          :options="(addressBooks.data ?? []).map((ab) => ({ label: ab._name, value: ab.name }))"
          :open-on-click="true"
        />
      </div>
    </template>
  </Dialog>
</template>
<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { userStore } from '@/apps/people/stores/user'

const show = defineModel<boolean>()

const { save } = defineProps<{ save: (value: string) => Promise<void> }>()

const { addressBooks } = userStore()

const addressBook = ref('')

const options = computed(() => ({
  title: __('Add to Address Book'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !addressBook.value,
      onClick: async () => {
        try {
          await save(addressBook.value.split('|').at(-1) ?? addressBook.value)
          show.value = false
        } catch {
          /* The command reports the refusal. Keep the draft open. */
        }
      },
    },
  ],
}))

watch(show, (val) => {
  if (val) addressBook.value = ''
})
</script>
