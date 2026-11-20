<template>
  <Dialog v-model:open="show" v-bind="options">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="address.type"
          type="select"
          :label="__('Type')"
          :options="TYPE_OPTIONS"
          required
        />
        <FormControl v-model="address.street" :label="__('Street')" required />
        <FormControl v-model="address.locality" :label="__('Locality')" />
        <FormControl v-model="address.region" :label="__('Region')" />
        <FormControl v-model="address.postcode" :label="__('Postcode')" />
        <FormControl v-model="address.country" :label="__('Country')" />
      </div>
    </template>
  </Dialog>
</template>
<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

const show = defineModel<boolean>()

const { save } = defineProps<{
  save: (value: {
    type: string
    street: string
    locality: string
    region: string
    postcode: string
    country: string
  }) => Promise<void>
}>()

const DEFAULT_ADDRESS = {
  type: 'Personal',
  street: '',
  locality: '',
  region: '',
  postcode: '',
  country: '',
}

const address = reactive({ ...DEFAULT_ADDRESS })

const options = computed(() => ({
  title: __('Add Address'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !(address.type && address.street),
      onClick: async () => {
        try {
          await save({ ...address })
          show.value = false
        } catch {
          /* The command reports the refusal. Keep the draft open. */
        }
      },
    },
  ],
}))

watch(show, (val) => {
  if (val) Object.assign(address, DEFAULT_ADDRESS)
})

const TYPE_OPTIONS = [
  { label: __('Personal'), value: 'Personal' },
  { label: __('Work'), value: 'Work' },
  { label: __('Other'), value: 'Other' },
]
</script>
