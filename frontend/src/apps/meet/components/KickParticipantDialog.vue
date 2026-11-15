<template>
  <Dialog v-model:open="showDialog" :title="__('Remove participant')" size="sm">
    <template #default>
      <div class="space-y-4">
        <p class="text-base text-ink-gray-7">
          {{ __('Are you sure you want to remove {0} from the meeting?').split('{0}')[0] }}
          <strong>{{ participantName }}</strong>
          {{ __('Are you sure you want to remove {0} from the meeting?').split('{0}')[1] }}
        </p>
        <FormControl
          v-if="canBan"
          v-model="banFromMeeting"
          :label="__('Ban from this meeting?')"
          type="checkbox"
        />
      </div>
    </template>
    <template #actions>
      <div class="flex justify-end gap-2 w-full">
        <Button variant="subtle" @click="showDialog = false">{{ __('Cancel') }}</Button>
        <Button variant="solid" theme="red" @click="handleKickConfirm">{{ __('Remove') }}</Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

interface Props {
  participantName: string
  modelValue?: boolean
  canBan?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', ban: boolean): void
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  canBan: false,
})

const emit = defineEmits<Emits>()

const banFromMeeting = ref(false)

const showDialog = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    if (!value) banFromMeeting.value = false
    emit('update:modelValue', value)
  },
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) banFromMeeting.value = false
  },
)

const handleKickConfirm = () => {
  emit('confirm', banFromMeeting.value)
  banFromMeeting.value = false
  showDialog.value = false
}
</script>
