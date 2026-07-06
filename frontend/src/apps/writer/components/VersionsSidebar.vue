<template>
  <div
    class="bg-surface-gray-2 text-ink-gray-8 p-3 text-base flex justify-between items-center select-none"
  >
    <div class="flex flex-col gap-1">
      <div v-if="!versionPreview">
        <span class="text-ink-gray-6">You are viewing the version history of</span>
        {{ file.doc.file_name }}
      </div>
      <div v-else-if="versionPreview[0].manual">
        <span class="font-medium">{{ versionPreview[0].title }}</span>
      </div>
      <div v-else>
        This is an automatic snapshot of this document from
        {{ formatDateDDMMYY(versionPreview[0].title) }}.
      </div>
      <div class="text-xs text-ink-gray-5">Editing is disabled until you exit.</div>
    </div>
    <div class="flex gap-2">
      <Button
        variant="ghost"
        label="Exit"
        class="hover:!bg-surface-gray-2 hover:underline"
        @click="showVersions = false"
      />
      <Button
        v-if="versionPreview"
        variant="solid"
        label="Restore"
        @click="restore(versionPreview[0])"
      />
    </div>
  </div>
  <div class="flex h-full overflow-hidden">
    <div class="self-stretch w-72 border-e h-full relative">
      <div class="flex flex-col items-center w-full">
        <Tabs
          v-model="tab"
          class="w-full"
          as="div"
          :tabs="[{ label: 'Automatic' }, { label: 'Manual' }]"
        />
        <Button
          :icon="LucideX"
          variant="ghost"
          class="absolute right-1 top-2"
          @click="showVersions = false"
        />
      </div>
      <div class="p-3.5 gap-4 flex flex-col h-full overflow-y-auto">
        <Button
          v-if="tab === 1"
          :icon="LucidePlus"
          class="absolute right-3 bottom-3"
          variant="outline"
          @click="
            () =>
              createDialog({
                title: 'Create Version',
                size: 'sm',
                component: h(NewVersionDialog, {
                  data: editor.getHTML(),
                  document,
                }),
              })
          "
        />
        <div
          v-if="
            !Object.entries(groupedVersions).length || !Object.entries(groupedVersions)[0][1].length
          "
          class="text-ink-gray-5 text-sm text-center mt-1"
        >
          None yet.
        </div>
        <div
          v-for="[title, group] in Object.entries(groupedVersions)"
          v-else
          :key="title"
          class="flex flex-col gap-1 mb-2 justify-start bg-surface-base"
        >
          <div v-if="title !== 'Manual'" class="text-ink-gray-5 text-sm-medium mb-1 my-2">
            {{ title }}
          </div>
          <div class="grid grid-cols-3 gap-0.5">
            <Button
              v-for="(version, i) in group"
              :key="version.name"
              :variant="version.name === versionPreview?.[0]?.name ? 'solid' : 'ghost'"
              class="text-start text-sm py-4"
              :label="version.manual ? version.title : formatDateDDMMYY(version.title).slice(9, 14)"
              @click="
                version.name === versionPreview?.[0]?.name
                  ? (versionPreview = null)
                  : (versionPreview = [version, getPrevious(version)])
              "
            />
          </div>
        </div>
      </div>
    </div>
    <div class="flex-1 overflow-hidden">
      <div v-if="!versionPreview" class="text-base border-b text-ink-gray-8 p-3 select-none">
        This is the current version.
      </div>
      <Editor
        v-if="editor?.getHTML"
        class="diff-view prose prose-sm md:min-w-[48rem] md:max-w-[48rem] mx-auto py-8 px-10 h-full overflow-y-auto"
        :extensions="[RichTextKit, ...COMMON_EXTENSIONS, DiffTag]"
        :editable="false"
        :model-value="
          versionPreview
            ? generateHTMLDiff(versionPreview[0]?.snapshot, versionPreview[1]?.snapshot)
            : generateHTMLDiff(editor.getHTML(), versions.data[versions.data.length - 1]?.snapshot)
        "
      >
        <template #default="{ editor }">
          <EditorContent
            class="prose-sm prose-v3"
            :style="{
              fontFamily: `var(--font-${settings?.font_family})`,
              fontSize: `${settings?.font_size || 15}px`,
              lineHeight: settings?.line_height || 1.5,
            }"
            :editor
          />
        </template>
      </Editor>
    </div>
  </div>
</template>
<script setup>
import { COMMON_EXTENSIONS } from '@/apps/writer/utils'
import { diff_match_patch } from 'diff-match-patch'
import DiffTag from '@/apps/writer/extensions/diff-tag'
const dmp = new diff_match_patch()

function generateHTMLDiff(newHTML, oldHTML = '') {
  const parser = new DOMParser()
  const oldDoc = parser.parseFromString(oldHTML, 'text/html').body
  const newDoc = parser.parseFromString(newHTML, 'text/html').body

  const result = diffNode(oldDoc, newDoc)
  return result.map((node) => (typeof node === 'string' ? node : node.outerHTML)).join('')
}

function diffNode(oldNode, newNode) {
  // if both missing
  if (!oldNode && !newNode) return []

  // node removed
  if (oldNode && !newNode)
    return [`<del>${oldNode.outerHTML || escapeHTML(oldNode.textContent)}</del>`]

  // node added
  if (!oldNode && newNode)
    return [`<ins>${newNode.outerHTML || escapeHTML(newNode.textContent)}</ins>`]

  // different node type or tag
  if (oldNode.nodeName !== newNode.nodeName) {
    return [
      `<del>${oldNode.outerHTML || escapeHTML(oldNode.textContent)}</del>`,
      `<ins>${newNode.outerHTML || escapeHTML(newNode.textContent)}</ins>`,
    ]
  }

  // text node diff
  if (oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
    const diffs = dmp.diff_main(oldNode.textContent, newNode.textContent)
    dmp.diff_cleanupSemantic(diffs)
    return diffs.map(([type, text]) => {
      switch (type) {
        case -1:
          return `<del>${escapeHTML(text)}</del>`
        case 1:
          return `<ins>${escapeHTML(text)}</ins>`
        default:
          return escapeHTML(text)
      }
    })
  }

  // recursively diff children
  const resultNode = newNode.cloneNode(false)
  const oldChildren = [...oldNode.childNodes]
  const newChildren = [...newNode.childNodes]
  const len = Math.max(oldChildren.length, newChildren.length)

  for (let i = 0; i < len; i++) {
    const childDiff = diffNode(oldChildren[i], newChildren[i])
    childDiff.forEach((fragment) => {
      if (typeof fragment === 'string') {
        const span = document.createElement('span')
        span.innerHTML = fragment
        resultNode.append(...span.childNodes)
      } else {
        resultNode.append(fragment)
      }
    })
  }

  return [resultNode]
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

import LucideX from '~icons/lucide/x'
import LucidePlus from '~icons/lucide/plus'
import { onKeyDown } from '@vueuse/core'
import { computed, ref, h, watch, inject } from 'vue'
import emitter from '@/apps/writer/emitter'
import { Button, createResource, Tabs, toast, useList } from 'frappe-ui'
import { Editor, EditorContent, RichTextKit } from 'frappe-ui/editor'
import { clearDialogs, createDialog } from '@/apps/writer/utils/dialogs'
import NewVersionDialog from './NewVersionDialog.vue'

const props = defineProps({
  settings: Object,
  document: Object,
  editor: Object,
})
const emit = defineEmits(['saveDocument', 'newVersion'])
const versionPreview = defineModel()
const showVersions = defineModel('showVersions')

const file = inject('file')
const versions = createResource({
  url: 'suite.writer.api.general.get_versions',
  params: { id: file.doc.name },
  cache: ['versions', file.doc?.name],
  initialData: [],
  auto: true,
})

const manualVersions = computed(() => versions.data.filter((v) => v.manual))
const autoVersions = computed(() => versions.data.filter((v) => !v.manual))

function formatDateDDMMYY(dateStr) {
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
}

const groupedVersions = computed(() => {
  if (tab.value === 0) {
    const sortedAutoVersions = [...autoVersions.value].sort((a, b) => {
      return new Date(b.title) - new Date(a.title)
    })

    const grouped = sortedAutoVersions.reduce((acc, version) => {
      const date = formatDateDDMMYY(version.title).slice(0, 8)
      if (!acc[date]) {
        acc[date] = []
      }
      acc[date].push(version)
      return acc
    }, {})

    return grouped
  } else {
    return {
      Manual: [...manualVersions.value].sort((a, b) => {
        return new Date(b.title) - new Date(a.title)
      }),
    }
  }
})

const tab = ref(versions.data.filter((v) => v.manual).length ? 1 : 0)
watch(tab, () => (versionPreview.value = null))

const getPrevious = (version) => {
  // Important: Use the original arrays, not the reversed ones
  const relevantVersions = version.manual
    ? versions.data.filter((v) => v.manual)
    : versions.data.filter((v) => !v.manual)
  const currentIndex = relevantVersions.findIndex((v) => v.name === version.name)
  return relevantVersions[currentIndex - 1]
}

const restore = (version) => {
  createDialog({
    title: 'Are you sure?',
    size: 'sm',
    message: version.manual
      ? `You are restoring to a previous version: ${version.title}.`
      : `You are restoring the document to how it was at ${formatDateDDMMYY(version.title)}.`,
    actions: [
      {
        label: 'Confirm',
        variant: 'solid',
        onClick: () => {
          props.editor.commands.setContent(version.snapshot)
          toast.success(
            `Restored a previous version - ${version.manual ? version.title : formatDateDDMMYY(version.title)}`,
          )
          showVersions.value = false
          clearDialogs()
          emitter.emit('manual-save')
        },
      },
    ],
  })
}
onKeyDown('Escape', () => (showVersions.value = false))
</script>
<style>
@import url('@/apps/writer/styles/fonts.css');

.diff-view ins,
.diff-view s {
  padding: 0.5px 1px;
  border-radius: 3px;
}

.diff-view ins + s,
.diff-view s + ins {
  margin: 0 2px;
}

.diff-view ins {
  background-color: #dcfce7;
  color: #166534;
  text-decoration: none;
}

.diff-view s {
  background-color: #fee2e2;
  color: #991b1b;
  text-decoration: line-through;
}
</style>
