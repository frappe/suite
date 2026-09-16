<script setup lang="ts">
import { computed, h, nextTick, ref, useTemplateRef } from 'vue'
import {
  TagsInputRoot,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemText,
  TagsInputItemDelete,
} from 'reka-ui'
import { Combobox } from 'frappe-ui'
import { getLabel, getIcon, RenderIcon, getValue } from './utils'
import { type SimpleOption, type TagInputProps } from './types'

const isEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value)

const props = defineProps<TagInputProps>()
const options = defineModel<SimpleOption[]>('options', { default: [] })
const modelValue = defineModel<SimpleOption[]>({ default: [] })
const rerenderCombobox = ref(0)
const rootEl = useTemplateRef('root')
const query = ref('')

const optionsWithIcons = computed(() => {
  if (!props.renderIcon) return options.value
  return options.value.map((k) =>
    getIcon(k) ? k : { ...k, icon: props.renderIcon(k) },
  )
})
const selectedTags = computed(() => {
  return modelValue.value.map((k) => {
    return optionsWithIcons.value.find((j) => getValue(j) === k)
  })
})

const filteredOptions = computed(() => {
  let remainingOptions = optionsWithIcons.value.filter((opt) => {
    const val = getValue(opt)
    if (!val) return false
    return !modelValue.value.includes(val)
  })

  return [
    ...remainingOptions,
    {
      type: 'custom',
      key: 'add-email',
      label: 'Add email',
      // enabled once the typed text becomes a valid email
      disabled: !isEmail(query.value),
      condition: ({ query }: { query: string }) => {
        if (!query) return false
        const lower = query.toLowerCase()
        const matches = options.value.filter((opt) =>
          getLabel(opt).toLowerCase().includes(lower),
        )
        return matches.length === 0
      },
      onClick: ({ query }: any) => {
        const tag = {
          label: query,
          value: query,
        }
        options.value.push(tag)
        addTag(query)
      },
      // the icon dims with disabled (frappe-ui's OptionIcon hardcodes its color)
      slots: {
        prefix: () =>
          h('span', {
            class: [
              'lucide-user-plus size-4 shrink-0',
              isEmail(query.value) ? 'text-ink-gray-6' : 'text-ink-gray-4',
            ],
          }),
      },
    },
  ]
})

function focus() {
  rootEl.value?.$el?.querySelector('input')?.focus()
}

async function addTag(tag: string) {
  if (!tag) return
  if (!modelValue.value.includes(tag)) modelValue.value.push(tag)
  query.value = ''
  rerenderCombobox.value += 1
  // the :key rerender replaces the input; restore focus so more tags can be typed
  await nextTick()
  focus()
}

function removeTag(tag: string) {
  modelValue.value = modelValue.value.filter((t) => t !== tag)
}
</script>

<template>
  <!-- Box-less: the consumer owns the field chrome (border, padding, bg) -->
  <TagsInputRoot
    ref="root"
    v-model="modelValue"
    class="flex flex-wrap gap-1.5 w-full items-center justify-start"
  >
    <TagsInputItem
      v-for="item in selectedTags"
      :key="getValue(item)"
      :value="getValue(item)"
      class="flex min-h-7 items-center gap-1.5 rounded-4 bg-surface-gray-2 px-2 text-base focus:outline-none data-[state=active]:ring-1 data-[state=active]:ring-outline-gray-3"
    >
      <RenderIcon :icon="getIcon(item)" />
      <TagsInputItemText class="text-base text-ink-gray-8">{{
        getLabel(item)
      }}</TagsInputItemText>
      <TagsInputItemDelete
        class="p-0.5 rounded-1 bg-transparent hover:bg-surface-gray-3"
        @click="removeTag(getValue(item))"
      >
        <span class="lucide-x size-3.5 text-ink-gray-6" aria-hidden="true" />
      </TagsInputItemDelete>
    </TagsInputItem>
    <TagsInputInput :as-child="true">
      <!-- Explicitly set unset type as TagInput passes it in -->
      <Combobox
        :key="rerenderCombobox"
        :options="filteredOptions"
        type=""
        :placeholder
        class="flex-1 min-w-[100px] text-base focus:outline-none"
        @update:modelValue="addTag"
        :open-on-click="false"
        variant="ghost"
        empty-text="No users found"
        @update:query="query = $event"
      >
        <template #item-label="{ item, query: typed }">
          <template v-if="item.key === 'add-email'">Add "{{ typed }}"</template>
          <template v-else>
            {{ item.label }}
            <span
              v-if="item.description || (item.value && item.value !== item.label)"
              class="text-ink-gray-5"
            >
              ({{ item.description || item.value }})
            </span>
          </template>
        </template>
      </Combobox>
    </TagsInputInput>
  </TagsInputRoot>
</template>
<style scoped>
/* The outer TagsInputRoot is the visible field — strip the inner combobox
   anchor's own chrome (focus ring, hover fill) and its dropdown chevron.
   The focus ring is an `outline` (see frappe-ui tailwind/plugin.js). */
:deep([data-slot='trigger']) {
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
  border: 0 !important;
}
:deep([data-slot='chevron']),
:deep([aria-label='Show popup']) {
  display: none;
}
</style>
