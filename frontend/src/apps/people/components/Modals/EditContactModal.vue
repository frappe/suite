<template>
  <Dialog v-model:open="show" v-bind="options">
    <template #default>
      <div class="space-y-4">
        <FormControl v-model="contact.fullName" :label="__('Name')" />
        <FormControl
          v-model="contact.kind"
          type="select"
          :label="__('Kind')"
          :options="KIND_OPTIONS"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

const show = defineModel<boolean>()

const { fullName, kind, save } = defineProps<{
  fullName?: string | null
  kind?: string | null
  save: (value: { fullName: string; kind: string }) => Promise<void>
}>()

const contact = reactive({ fullName: fullName ?? '', kind: kind ?? 'Individual' })

const options = computed(() => ({
  title: __('Edit General Information'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: contact.fullName === fullName && contact.kind === kind,
      onClick: async () => {
        try {
          await save({ ...contact })
          show.value = false
        } catch {
          /* The command reports the refusal. Keep the draft open. */
        }
      },
    },
  ],
}))

watch(show, (open) => {
  if (open) Object.assign(contact, { fullName: fullName ?? '', kind: kind ?? 'Individual' })
})

const KIND_OPTIONS = [
  { label: __('Individual'), value: 'Individual' },
  { label: __('Group'), value: 'Group' },
]
</script>
