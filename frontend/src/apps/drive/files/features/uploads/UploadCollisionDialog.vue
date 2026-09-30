<template>
  <Dialog v-model:open="open" title="A file with this name exists" size="md">
    <form class="space-y-4" @submit.prevent="submit">
      <p class="text-p-base text-ink-gray-7">
        This folder already has a file named <span class="font-medium text-ink-gray-8">{{ title }}</span>.
      </p>
      <RadioGroup v-model="action" orientation="vertical">
        <Radio
          v-if="canReplace"
          value="replace"
          label="Replace"
          description="The current file is not kept."
        />
        <Radio value="keep-both" label="Keep both" :description="`Upload as ${freeTitle}.`" />
        <Radio value="rename" label="Rename" />
        <Radio value="skip" label="Skip" />
      </RadioGroup>
      <!-- Always rendered, so the dialog keeps its height when Rename is picked. -->
      <FormControl
        v-model="renamed"
        label="New name"
        :disabled="action !== 'rename'"
        :required="action === 'rename'"
      />
      <Checkbox v-if="batch" v-model="applyToAll" label="Apply to all" :disabled="action === 'rename'" />
      <div class="flex justify-end gap-2">
        <Button label="Skip" @click="choose({ action: 'skip' })" />
        <Button type="submit" variant="solid" theme="gray" label="Continue" :disabled="!valid" />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Checkbox, Dialog, FormControl, Radio, RadioGroup } from 'frappe-ui'

import type { CollisionChoice } from './queue'

/**
 * Asks what to do with a file whose title is taken (spec §6.4). Replace shows
 * only with EDIT on the file there. "Apply to all" does not carry a rename.
 */
const props = defineProps<{ title: string; freeTitle: string; canReplace: boolean; batch: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [choice: CollisionChoice & { applyToAll: boolean }] }>()

const action = ref<CollisionChoice['action']>('keep-both')
const renamed = ref(props.freeTitle)
const applyToAll = ref(false)
const valid = computed(() => action.value !== 'rename' || (!!renamed.value.trim() && renamed.value.trim() !== props.title))

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
