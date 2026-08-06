<template>
  <div
    class="items-center gap-2 px-3 pt-3 min-h-12 sm:flex sm:flex-wrap sm:px-5"
    :class="selectionMode ? 'flex flex-wrap' : 'grid grid-cols-[auto_minmax(0,1fr)]'"
  >
    <div v-if="selectionMode" class="flex min-w-0 items-center gap-2">
      <span class="whitespace-nowrap text-base text-ink-gray-8">
        {{ selections.length }} {{ __('selected') }}
      </span>
      <Button v-if="view !== 'list'" variant="outline"
        :label="allSelected ? __('Unselect all') : __('Select all {0}', [selectableCount])"
        @click="emit('select-all')" />
    </div>
    <div v-if="!selectionMode && $route.name === 'drive-Home'"
      class="bg-surface-gray-2 rounded-md space-x-0.5 h-7 flex items-center sm:mr-2 py-1">
      <TabButtons v-model="shareView" :options="[
        {
          label: __('Yours'),
          value: false,
        },
        {
          label: __('With you'),
          value: true,
        },
      ]" />
    </div>
    <TextInput ref="search-input" v-model="search" :disabled :class="[
      selectionMode ? 'hidden' : 'block',
      $route.name === 'drive-Home' ? '' : 'col-span-2 sm:col-span-1',
    ]"
      :placeholder="__('Find')" class="min-w-0 flex-1 sm:w-[30%] sm:flex-none">
      <template #prefix>
        <LucideSearch class="size-4" />
      </template>
    </TextInput>
    <div class="col-span-2 flex min-w-0 w-full justify-end gap-2 my-auto sm:ml-auto sm:w-auto">
      <template v-if="!selectionMode">
        <div v-if="activeFilters.length"
          class="min-w-0 flex-1 overflow-x-auto sm:ml-3 sm:flex sm:flex-initial sm:flex-wrap sm:items-start sm:justify-end sm:gap-1 sm:overflow-visible">
          <div class="flex min-w-full w-max justify-end gap-1 sm:contents">
            <div v-for="({ icon, name }, index) in activeFilters" :key="index" class="shrink-0">
              <div class="flex items-center border rounded pl-2 py-1 h-7 text-base select-none">
                <img class="w-4" :src="icon" />
                <span class="text-sm ml-2">{{ name }}</span>
                <Button variant="minimal" :icon="h(LucideX, { class: 'size-3' })"
                  @click="activeFilters.splice(index, 1)" />
              </div>
            </div>
          </div>
        </div>
        <Button v-if="delayedLoading" :loading="true" label="Loading..." />
        <div data-testid="drive-filter">
          <Dropdown :options="filterOptions" :disabled placement="right">
            <template #trigger="{ open }">
              <Button :active="open" :disabled icon="lucide-filter" tooltip="Filter" />
            </template>
          </Dropdown>
        </div>
        <SortControl v-if="$route.name !== 'Recents' && view !== 'list'" v-model="sortOrder" :options="columnHeaders"
          :menu-items="sortMenuItems" :disabled />

        <TabButtons v-model="view" :options="[
          {
            icon: 'lucide-layout-grid',
            value: 'grid',
            disabled,
          },
          {
            icon: 'lucide-list',
            value: 'list',
            disabled,
          },
        ]" />
      </template>
      <div v-else-if="selections.length && actionItems" class="flex gap-2 overflow-auto">
        <template v-for="item in actionItems
          .filter((i) => i.important && (selections.length === 1 || i.multi))
          .filter(
            (i) =>
              !i.isEnabled ||
              selections.every((e) => i.isEnabled(e, selections.length !== 1))
          )" :key="item.label">
          <Button variant="outline" :tooltip="item.label" @click.once="item.action(selections)">
            <template #icon>
              <component :is="item.icon" class="size-4 text-ink-gray-6"
                :class="[item.class, item.theme ? 'text-ink-red-6' : '']" />
            </template>
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup>
import { Button, Dropdown, TextInput, TabButtons } from 'frappe-ui'
import {
  ref,
  computed,
  watch,
  useTemplateRef,
  h,
  onWatcherCleanup,
} from 'vue'
import { getIconUrl } from '@/apps/drive/utils/files'
import { view, shareView } from '@/apps/drive/data/prefs'
import { onKeyDown } from '@vueuse/core'
import SortControl from '@/components/SortControl.vue'

import LucideX from '~icons/lucide/x'

const sortOrder = defineModel('sortOrder')
const search = defineModel('search')
const props = defineProps({
  selections: Array,
  actionItems: Array,
  getEntities: Object,
  selectableCount: Number,
  allSelected: Boolean,
  selectionMode: Boolean,
})
const emit = defineEmits(['select-all'])

const activeFilters = defineModel('filters')
const disabled = computed(() => !props.getEntities.data?.length)

const searchInput = useTemplateRef('search-input')

const delayedLoading = ref(false)

watch(
  () => props.getEntities.loading,
  (newVal) => {
    if (newVal) {
      const timer = setTimeout(() => {
        delayedLoading.value = true
      }, 1000)
      onWatcherCleanup(() => clearTimeout(timer))
    } else {
      delayedLoading.value = false
    }
  },
  { immediate: true }
)

const availableFilterTypes = computed(() => {
  if (!props.getEntities.data) return []
  const types = new Set(props.getEntities.data.map((r) => r.file_type))
  if (props.getEntities.data.find((k) => k.is_folder)) types.add('Folder')
  return Array.from(types)
    .sort((a, b) => (a > b ? 1 : -1))
    .map((t) => ({ name: t, icon: getIconUrl(t) }))
})

const filterOptions = computed(() =>
  availableFilterTypes.value.map(({ name, icon }) => {
    const selected = activeFilters.value.some((filter) => filter.name === name)
    return {
      label: __(name),
      icon: selected ? 'lucide-check' : h('img', { src: icon }),
      selected,
      onClick: () => toggleTypeFilter({ name, icon }),
    }
  })
)

function toggleTypeFilter(filter) {
  const index = activeFilters.value.findIndex(({ name }) => name === filter.name)
  if (index === -1) activeFilters.value.push(filter)
  else activeFilters.value.splice(index, 1)
}

onKeyDown('Escape', () => {
  searchInput.value.el.blur()
  search.value = ''
})

const columnHeaders = [
  {
    label: __('Name'),
    field: 'file_name',
  },
  {
    label: __('Owner'),
    field: 'owner',
  },
  {
    label: __('Modified'),
    field: 'modified',
  },
  {
    label: __('Size'),
    field: 'file_size',
  },
  {
    label: __('Type'),
    field: 'file_type',
  },
]

const sortMenuItems = computed(() => [
  {
    group: true,
    hideLabel: true,
    items: [
      {
        label: __('Smart'),
        disabled: sortOrder.value.field !== 'file_name',
        switch: true,
        switchValue: sortOrder.value.smart,
        onClick: (val) => (sortOrder.value.smart = val),
      },
    ],
  },
])
</script>
