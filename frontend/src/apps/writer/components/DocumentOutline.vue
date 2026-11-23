<template>
  <nav v-if="shownAnchors.length > 1" class="document-outline" :aria-label="__('Outline')">
    <a
      v-for="anchor in shownAnchors"
      :key="anchor.id"
      :href="'#' + anchor.id"
      class="block truncate py-1 text-sm hover:text-ink-gray-8"
      :class="anchor.isActive ? 'font-medium text-ink-gray-8' : 'text-ink-gray-5'"
      :style="{ paddingInlineStart: `${(anchor.level - topLevel) * 0.75}rem` }"
      :title="anchor.textContent"
      @click.prevent="goToAnchor(anchor.id)"
    >
      {{ anchor.textContent }}
    </a>
  </nav>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { computed } from 'vue'

import { tabIdAt } from '@/apps/writer/extensions/tabs'

import { useDocumentTabs } from './useDocumentTabs'

interface Anchor {
  id: string
  level: number
  textContent: string
  isActive: boolean
}

const props = defineProps<{ editor: Editor; anchors: unknown[] }>()

const { tabs, activeTabId } = useDocumentTabs(props.editor)

function isAnchor(value: unknown): value is Anchor {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'level' in value &&
    typeof value.level === 'number' &&
    'textContent' in value &&
    typeof value.textContent === 'string' &&
    'isActive' in value &&
    typeof value.isActive === 'boolean'
  )
}

function headingOf(id: string) {
  return props.editor.view.dom.querySelector<HTMLElement>(`[data-toc-id="${id}"]`)
}

const shownAnchors = computed(() => {
  const anchors = props.anchors.filter(isAnchor)
  if (!tabs.value.length || !activeTabId.value) return anchors
  return anchors.filter((anchor) => {
    const heading = headingOf(anchor.id)
    if (!heading) return false
    const position = props.editor.view.posAtDOM(heading, 0)
    return tabIdAt(props.editor.state.doc, position) === activeTabId.value
  })
})

const topLevel = computed(() => Math.min(...shownAnchors.value.map((anchor) => anchor.level)))

function goToAnchor(id: string) {
  const heading = headingOf(id)
  if (!heading) return
  const { view } = props.editor
  const position = view.posAtDOM(heading, 0)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)))
  view.focus()
  history.pushState(null, '', `#${id}`)
  document.querySelector('#editor-scroll-container')?.scrollTo({ top: heading.offsetTop })
}
</script>

<style scoped>
/* Lines up with the text's first line, and stays in the margin only while the margin has room. */
.document-outline {
  position: sticky;
  top: 0;
  display: none;
  max-height: calc(100vh - 8rem);
  overflow-y: auto;
  padding: 1.5rem 0.75rem 2.5rem 1rem;
}

@container (min-width: 10rem) {
  .document-outline {
    display: block;
  }
}
</style>
