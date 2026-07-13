<template>
  <Combobox
    v-model="selected"
    :variant
    :options="
      options.map((k) => ({
        ...k,
        value: k.key,
        slot: 'font',
      }))
    "
    :placeholder="options.find((k) => k.key === font_family)?.label"
    :open-on-click="true"
    class="min-w-[10rem]"
    variant="outline"
    @update:model-value="onSelect"
  >
    <template #font="{ option }"
      ><span :style="{ fontFamily: `var(--font-${option.key})` }">
        {{ option.label }}</span
      ></template
    >
  </Combobox>
</template>
<script setup>
import { Combobox } from 'frappe-ui'
import { FONT_FAMILIES } from '@/apps/writer/utils'

const selected = defineModel()
const props = defineProps({
  font_family: String,
  editor: { type: Object, default: null },
  variant: { type: String, default: 'outline' },
  options: { type: Array, default: FONT_FAMILIES },
})

const onSelect = (val) => {
  if (!props.editor || !val) return
  props.options.find((k) => k.key === val)?.action(props.editor)
}
</script>
