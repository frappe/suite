<template>
  <Dialog v-model:open="open" :title="__('A file with this name exists')" size="md">
    <form class="space-y-4" @submit.prevent="submit">
      <p class="text-p-base text-ink-gray-7">
        {{ __('This folder already has a file named “{0}”.', [title]) }}
      </p>
      <RadioGroup v-model="action" orientation="vertical">
        <Radio
          value="keep-both"
          :label="__('Keep both')"
          :description="__('Upload as {0}.', [freeTitle])"
        />
        <Radio
          v-if="canReplace"
          value="replace"
          :label="__('Replace')"
          :description="__('The current file is not kept.')"
        />
        <Radio value="rename" :label="__('Rename')" />
      </RadioGroup>
      <div v-if="action === 'rename'" ref="nameField">
        <FormControl v-model="renamed" :label="__('New name')" required />
      </div>
      <Checkbox
        v-if="batch"
        v-model="applyToAll"
        :label="__('Apply to all')"
        :disabled="action === 'rename'"
      />
      <div class="flex justify-end gap-2">
        <Button :label="__('Skip')" @click="choose({ action: 'skip' })" />
        <Button
          type="submit"
          variant="solid"
          :theme="action === 'replace' ? 'red' : 'gray'"
          :label="submitLabel"
          :disabled="!valid"
        />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Checkbox, Dialog, FormControl, Radio, RadioGroup } from 'frappe-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { translate as __ } from '@/platform/translation'

import type { CollisionChoice } from './queue'

/**
 * Asks what to do with a file whose title is taken (spec §6.4). Replace shows
 * only with EDIT on the file there. "Apply to all" does not carry a rename.
 * Skip is only a button, and the name field shows for Rename.
 */
const props = defineProps<{
  title: string
  freeTitle: string
  canReplace: boolean
  batch: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [choice: CollisionChoice & { applyToAll: boolean }] }>()

const action = ref<CollisionChoice['action']>('keep-both')
const renamed = ref(props.freeTitle)
const applyToAll = ref(false)
const nameField = ref<HTMLElement>()
const valid = computed(
  () =>
    action.value !== 'rename' || (!!renamed.value.trim() && renamed.value.trim() !== props.title),
)
const submitLabel = computed(() => {
  if (action.value === 'replace') return __('Replace')
  if (action.value === 'rename') return __('Rename')
  return __('Keep both')
})

// The name is ready to type over, its extension kept.
watch(action, async (next) => {
  if (next !== 'rename') return
  await nextTick()
  const input = nameField.value?.querySelector('input')
  if (!input) return
  input.focus()
  const dot = input.value.lastIndexOf('.')
  input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
})

function submit() {
  if (!valid.value) return
  if (action.value === 'rename') choose({ action: 'rename', title: renamed.value.trim() })
  else choose({ action: action.value })
}

function choose(choice: CollisionChoice) {
  emit('choose', { ...choice, applyToAll: choice.action !== 'rename' && applyToAll.value })
  open.value = false
}
</script>
