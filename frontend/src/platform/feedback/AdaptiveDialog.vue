<!--
  Drop-in Dialog replacement: a dialog on a computer, a sheet from the bottom on a phone, where a
  card in the middle of the screen is out of the thumb's reach and too narrow for its fields.

  In the sheet the dialog's actions stand one above the other at its foot, the width of the sheet.
  A dialog that only asks something (a message and its actions, nothing of its own) is an action
  sheet: its question in the middle, and Cancel last, one of its own if it has one.
-->
<template>
  <BottomSheet
    v-if="isMobile"
    :open="isOpen"
    :title
    :dismissible
    @update:open="setOpen"
    @after-leave="emit('after-leave')"
  >
    <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <slot :close>
        <p v-if="message" class="text-p-base text-ink-gray-7 px-2 pb-2 text-center">
          {{ message }}
        </p>
      </slot>
      <div v-if="actions?.length || $slots.actions" class="mt-6 flex flex-col gap-2">
        <slot name="actions" :close :actions="shownActions">
          <Button
            v-for="action in shownActions"
            :key="action.label"
            v-bind="action"
            size="lg"
            class="w-full"
            @click="run(action)"
          />
          <Button
            v-if="isQuestion"
            size="lg"
            class="w-full"
            :label="__('Cancel')"
            @click="run({ label: __('Cancel') })"
          />
        </slot>
      </div>
    </div>
  </BottomSheet>
  <Dialog
    v-else
    v-bind="dialogProps"
    :open="isOpen"
    @update:open="setOpen"
    @after-leave="emit('after-leave')"
  >
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name v-bind="scope ?? {}" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { BottomSheet, Button, Dialog, type DialogAction, type DialogProps } from 'frappe-ui'
import { computed, reactive, useSlots } from 'vue'

import { useScreenSize } from '@/composables/useScreenSize'
import { translate as __ } from '@/platform/translation'

const props = withDefaults(defineProps<DialogProps>(), {
  open: undefined,
  modelValue: undefined,
  dismissible: true,
  showCloseButton: true,
})
const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:modelValue': [value: boolean]
  close: []
  'after-leave': []
}>()
const slots = useSlots()

const { isMobile } = useScreenSize()

// As Dialog: `open` wins over `modelValue` when both are bound.
const isOpen = computed(() => (props.open !== undefined ? props.open : !!props.modelValue))
function setOpen(value: boolean) {
  emit('update:open', value)
  emit('update:modelValue', value)
  if (!value) emit('close')
}
function close() {
  setOpen(false)
}

const dialogProps = computed(() => {
  const { open: _open, modelValue: _modelValue, ...rest } = props
  return rest
})

// An action's click may wait on the server; its button shows so while it does, as Dialog's do.
const pending = reactive(new Set<string>())
const shownActions = computed(() =>
  (props.actions ?? []).flatMap((action) => {
    // A question's own Cancel is the one it ends with, so it is not shown twice
    if (isQuestion.value && action.label === __('Cancel')) return []

    const { onClick: _onClick, ...button } = action
    return [
      {
        ...button,
        label: action.label ?? '',
        loading: action.loading || pending.has(action.label ?? ''),
      },
    ]
  }),
)
async function run(shown: { label: string }) {
  const action = props.actions?.find((each: DialogAction) => (each.label ?? '') === shown.label)
  // As Dialog: an action with nothing of its own to do closes it.
  if (!action?.onClick) return close()
  pending.add(shown.label)
  try {
    await action.onClick({ close })
  } finally {
    pending.delete(shown.label)
  }
}

const isQuestion = computed(() => !slots.default && !!props.actions?.length)
</script>
