<template>
  <Dialog v-model:open="show" size="xl" position="top" @after-leave="resetState">
    <template #body>
      <div class="flex flex-col">
        <div class="relative">
          <div class="p-1.5">
            <TextInput
              ref="inputRef"
              variant="ghost"
              v-model="query"
              @update:model-value="activeIndex = 0"
              type="text"
              placeholder="Search templates..."
              @keydown="onKeyDown"
              autocomplete="off"
            >
              <template #prefix><LucideSearch class="size-4 text-ink-gray-6" /></template>
            </TextInput>
          </div>
          <div
            ref="scrollContainerRef"
            class="max-h-96 overflow-auto border-t border-outline-gray-1 dark:border-outline-gray-2"
            @click="inputRef?.focus()"
          >
            <div
              v-if="filteredTemplates.length === 0"
              class="px-4.5 py-8 text-center flex flex-col gap-2 text-ink-gray-5"
            >
              <LucideFileText class="mx-auto size-6" />
              <p class="text-base">
                {{ query ? 'No templates found' : 'No templates available' }}
              </p>
            </div>
            <div v-else class="py-2">
              <div
                v-for="(template, index) in filteredTemplates"
                :key="template.name"
                class="px-2.5"
              >
                <div
                  @click="onSelection(template)"
                  @mouseover="setActiveIndex(index)"
                  class="flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 transition-colors"
                  :class="[activeIndex === index ? 'bg-surface-gray-3' : 'hover:bg-surface-gray-2']"
                  :ref="
                    (el) => {
                      if (activeIndex === index) activeItemRef = el as HTMLDivElement
                    }
                  "
                >
                  <LucideFileText class="size-4 text-ink-gray-6" />

                  <div class="min-w-0 flex-1">
                    <div class="truncate text-base-medium text-ink-gray-7">
                      {{ template.title }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          class="mt-2 flex items-center justify-between border-t border-outline-gray-1 px-2.5 py-2 text-xs text-ink-gray-6 dark:border-outline-gray-2"
        >
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-1">
              <KeyboardShortcut bg>
                <LucideArrowDown class="size-4" />
              </KeyboardShortcut>
              <KeyboardShortcut bg>
                <LucideArrowUp class="size-4" />
              </KeyboardShortcut>
              <span class="ml-1">to navigate</span>
            </div>
            <div class="flex items-center gap-1">
              <KeyboardShortcut bg>
                <LucideCornerDownLeft class="size-4" />
              </KeyboardShortcut>
              <span class="ml-1">to insert</span>
            </div>
            <div class="flex items-center gap-1">
              <KeyboardShortcut bg>esc</KeyboardShortcut>
              <span class="ml-1">to close</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, useTemplateRef } from 'vue'
import fuzzysort from 'fuzzysort'
import { Dialog, TextInput } from 'frappe-ui'
import { insertTemplate } from '@/apps/writer/utils'
import { getTemplates } from '@/apps/writer/resources'

import LucideSearch from '~icons/lucide/search'
import LucideFileText from '~icons/lucide/file-text'
import LucideCornerDownLeft from '~icons/lucide/corner-down-left'
import LucideArrowDown from '~icons/lucide/arrow-down'
import LucideArrowUp from '~icons/lucide/arrow-up'

interface Template {
  name: string
  title: string
  content: string
}

interface Props {
  editor: any
}

const show = defineModel<boolean>()
const props = defineProps<Props>()

const query = ref('')
const activeIndex = ref(0)
const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const activeItemRef = ref<HTMLDivElement | null>(null)

const filteredTemplates = computed(() => {
  if (!getTemplates.data) return []
  if (!query.value) return getTemplates.data

  const results = fuzzysort.go(query.value, getTemplates.data, {
    keys: ['title', 'content'],
    threshold: -10000,
    limit: 10,
  })

  return results.map((result) => result.obj)
})

function onSelection(template: Template) {
  insertTemplate(template, props.editor)
  show.value = false
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    navigateList(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    navigateList(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (filteredTemplates.value[activeIndex.value]) {
      onSelection(filteredTemplates.value[activeIndex.value])
    }
  } else if (e.key === 'Escape') {
    show.value = false
  }
}

function navigateList(direction: number) {
  const maxIndex = filteredTemplates.value.length - 1

  activeIndex.value += direction

  if (activeIndex.value < 0) {
    activeIndex.value = maxIndex
  } else if (activeIndex.value > maxIndex) {
    activeIndex.value = 0
  }

  nextTick(scrollActiveItemIntoView)
}

function scrollActiveItemIntoView() {
  if (activeItemRef.value) {
    activeItemRef.value.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }
}

function setActiveIndex(index: number) {
  activeIndex.value = index
}

function resetState() {
  query.value = ''
  activeIndex.value = 0
}

watch(show, (value) => {
  if (value) {
    resetState()
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})
</script>
