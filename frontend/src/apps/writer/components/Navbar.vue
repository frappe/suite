<template>
  <nav
    id="navbar"
    ondragstart="return false;"
    ondrop="return false;"
    class="bg-surface-base border-b pr-3 py-2.5 h-12 flex items-center justify-between"
  >
    <div class="pl-4 pr-1">
      <Dropdown
        v-if="$route.name !== 'writer-home'"
        :options="[
          {
            label: 'Back to Home',
            icon: LucideChevronLeft,
            route: { name: 'writer-home' },
          },
        ]"
      >
        <WriterLogo class="size-7 cursor-pointer" />
      </Dropdown>
      <WriterLogo v-else class="size-7" />
    </div>
    <slot name="breadcrumbs">
      <Breadcrumbs
        :items="formattedCrumbs"
        class="select-none truncate max-w-[80%]"
      />
    </slot>

    <div class="ml-auto flex items-center gap-3">
      <div id="navbar-content" class="flex gap-3" />
      <slot name="content" />
      <Button
        v-if="isOffline"
        label="You're offline"
        variant="solid"
        size="sm"
        class="pointer-events-none"
        :icon-left="h(LucideWifiOff, { class: 'size-4' })"
      />
      <div v-if="file?.doc?.share_count" class="flex items-center">
        <LucideGlobe2 v-if="file.doc.share_count === -2" class="size-4 text-ink-gray-6" />
        <LucideBuilding2
          v-else-if="file.doc.share_count === -1"
          class="size-4 text-ink-gray-6"
        />
        <LucideUsers v-else-if="file.doc.share_count > 0" class="size-4 text-ink-gray-6" />
      </div>
      <LucideStar
        v-if="file?.doc?.is_favourite"
        class="size-4 my-auto stroke-amber-500 fill-amber-500 mx-1.5"
      />
      <template v-if="!isLoggedIn">
        <Button variant="outline" @click="signIn">
          Sign In
        </Button>
        <Button
          v-if="!isLoggedIn"
          class="hidden md:block"
          variant="solid"
          label="Try out Drive"
          @click="
            open('https://frappecloud.com/dashboard/signup?product=drive')
          "
        />
      </template>
      <Button
        v-else-if="$route.name === 'writer-home'"
        label="New"
        variant="solid"
        :icon-left="h(LucidePlus, { class: 'size-4' })"
        @click="
          createDocument.submit(null, {
            onSuccess: (d) =>
              $router.push({
                name: 'writer-document',
                params: { id: d.name },
              }),
          })
        "
      />
      <Dropdown
        v-else-if="fileActions.length"
        :options="fileActions"
        placement="right"
        :button="{
          variant: 'ghost',
          icon: LucideMoreHorizontal,
        }"
      />
    </div>
    <Dialogs v-model="dialog" :docs="file?.doc && [file]" />
  </nav>
</template>
<script setup>
import { Button, Breadcrumbs, Dropdown } from 'frappe-ui'
import { getFileLink } from '@/apps/drive/ui/drive/js/utils'

import { useSessionStore } from '@/boot/session'
import emitter from '@/apps/writer/emitter'
import { ref, computed, inject, h } from 'vue'
import { createDocument, apps } from '@/apps/writer/resources/'
import { exportBlog } from '@/apps/writer/utils/exports'
import Dialogs from '@/apps/writer/components/Dialogs.vue'
import { dynamicList } from '@/apps/writer/utils/'
import { downloadZippedHTML, downloadMD } from '@/apps/writer/utils'
import { downloadDocxFromHtml } from '../utils/docxexporter'

import LucideUsers from '~icons/lucide/users'
import LucideBuilding2 from '~icons/lucide/building-2'
import LucideGlobe2 from '~icons/lucide/globe-2'
import LucideStar from '~icons/lucide/star'
import LucideLock from '~icons/lucide/lock'
import LucideFile from '~icons/lucide/file'
import LucideFileText from '~icons/lucide/file-text'
import LucideFolderArchive from '~icons/lucide/folder-archive'
import LucideFileUser from '~icons/lucide/file-user'
import LucideTrash from '~icons/lucide/trash'
import LucideMoreHorizontal from '~icons/lucide/more-horizontal'
import LucideShare2 from '~icons/lucide/share-2'
import LucideDownload from '~icons/lucide/download'
import LucidePlus from '~icons/lucide/plus'
import LucideLink from '~icons/lucide/link'
import LucideArrowLeftRight from '~icons/lucide/arrow-left-right'
import LucideSquarePen from '~icons/lucide/square-pen'
import LucideInfo from '~icons/lucide/info'
import LucideRulerDimensionLine from '~icons/lucide/ruler-dimension-line'
import LucideView from '~icons/lucide/view'
import LucideListRestart from '~icons/lucide/list-restart'
import LucideHistory from '~icons/lucide/history'
import LucideLayoutTemplate from '~icons/lucide/layout-template'
import LucideMarkdown from '~icons/lucide/pilcrow'
import LucideWifiOff from '~icons/lucide/wifi-off'
import LucideChevronLeft from '~icons/lucide/chevron-left'

import WriterLogo from './WriterLogo.vue'
import { useRoute } from 'vue-router'

const open = (url) => {
  window.open(url, '_blank')
}

const signIn = () => {
  window.location.href = '/login'
}

const props = defineProps({
  file: Object,
  document: { type: Object, required: false },
  breadcrumbs: {
    default: [],
  },
})

const isOffline = inject('isOffline', ref(false))

const showVersions = defineModel('showVersions')
const showTemplates = defineModel('showTemplates')

const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
const dialog = inject('dialog', ref(''))
const editor = inject('editor', null)

const route = useRoute()
const formattedCrumbs = computed(() => {
  const ORIG =
    route.name === 'writer-home'
      ? { label: 'Writer', href: '/writer' }
      : { label: 'Drive', href: '/drive' }
  if (!props.breadcrumbs.length) return [ORIG]
  return [
    ORIG,
    ...props.breadcrumbs.slice(1, -1).map((k) => ({
      ...k,
      href: '/drive/d/' + k.name,
    })),
    {
      ...props.breadcrumbs[props.breadcrumbs.length - 1],
      onClick: () => emitter.emit('rename'),
    },
  ]
})

const fileActions = computed(() =>
  props.document?.doc?.settings
    ? [
        {
          group: true,
          hideLabel: true,
          items: [
            {
              label: __('Share'),
              icon: LucideShare2,
              onClick: () => {
                dialog.value = 's'
              },
              isEnabled: () => props.file.doc.share,
            },
            {
              label: __('Download'),
              icon: LucideDownload,
              isEnabled: () => props.file.doc.allow_download,
              onClick: () => emitter.emit('print-file'),
            },
            {
              label: __('Copy Link'),
              icon: LucideLink,
              onClick: () => getFileLink(props.file.doc),
            },
          ],
        },
        {
          group: true,
          hideLabel: true,
          items: [
            {
              label: __('Move'),
              icon: LucideArrowLeftRight,
              onClick: () => (dialog.value = 'm'),
              isEnabled: () => props.file.doc.write,
            },
            {
              label: __('Rename'),
              icon: LucideSquarePen,
              onClick: () => (dialog.value = 'rn'),
              isEnabled: () => props.file.doc.write,
            },
            {
              label: __('Show Info'),
              icon: LucideInfo,
              onClick: () => (dialog.value = 'i'),
            },
            {
              label: __('Favourite'),
              icon: LucideStar,
              onClick: () => {
                props.file.doc.is_favourite = true
                toggleFav.submit({ entities: [props.file.doc] })
              },
              isEnabled: () => !props.file.doc.is_favourite,
            },
            {
              label: __('Unfavourite'),
              icon: LucideStar,
              color: 'stroke-amber-500 fill-amber-500',
              onClick: () => {
                props.file.doc.is_favourite = false
                toggleFav.submit({ entities: [props.file.doc] })
              },
              isEnabled: () => props.file.doc.is_favourite,
            },
          ],
        },
        {
          group: true,
          hideLabel: true,
          items: dynamicList([
            {
              label: 'View',
              icon: LucideView,
              cond: props.file.doc.write,
              submenu: [
                {
                  label: 'Lock',
                  switch: true,
                  switchValue: props.document.doc.settings.lock,
                  icon: LucideLock,
                  onClick: (val) => {
                    props.document.doc.settings.lock = val
                    props.document.updateSettings.submit({
                      data: JSON.stringify(props.document.doc.settings),
                    })
                  },
                },
                {
                  label: 'Wide',
                  icon: LucideRulerDimensionLine,
                  switch: true,
                  switchValue: props.document.doc.settings.wide,
                  onClick: (val) => {
                    props.document.doc.settings.wide = val
                    props.document.updateSettings.submit({
                      data: JSON.stringify(props.document.doc.settings),
                    })
                  },
                },
              ],
            },
            {
              label: 'Export',
              icon: LucideDownload,
              submenu: [
                {
                  label: 'PDF',
                  icon: LucideFile,
                  onClick: () => {
                    emitter.emit('print-file')
                  },
                },
                {
                  label: 'DOCX',
                  icon: LucideFileText,
                  onClick: () => {
                    downloadDocxFromHtml(
                      editor.getHTML(),
                      `${file.doc.file_name}.docx`,
                      props.document?.doc?.settings,
                    )
                  },
                },
                {
                  label: 'Folder',
                  icon: LucideFolderArchive,
                  onClick: () => {
                    downloadZippedHTML(
                      editor,
                      props.file.doc.file_name,
                      props.document?.doc?.settings,
                    )
                  },
                },
                {
                  label: 'Markdown',
                  icon: LucideMarkdown,
                  onClick: () => downloadMD(editor, props.file.doc.file_name),
                },
                {
                  onClick: exportBlog,
                  label: 'Blog',
                  icon: LucideFileUser,
                  cond: apps.data && apps.data.find((k) => k.name === 'blog'),
                },
              ],
            },
            {
              icon: LucideHistory,
              label: 'Versions',
              cond: props.file.doc.write,
              onClick: () => (showVersions.value = true),
            },
            {
              icon: LucideLayoutTemplate,
              label: 'Templates',
              cond: props.file.doc.write,
              onClick: () => (showTemplates.value = true),
            },
          ]),
        },
        {
          group: true,
          hideLabel: true,
          items: [
            {
              onClick: () => clearCache(),
              label: 'Clear Cache',
              icon: LucideListRestart,
            },
            {
              label: __('Delete'),
              icon: LucideTrash,
              onClick: () => (dialog.value = 'remove'),
              isEnabled: () => props.file.doc.write,
              theme: 'red',
            },
          ],
        },
      ].map((k) => {
        return {
          ...k,
          items: k.items.filter((l) => !l.isEnabled || l.isEnabled()),
        }
      })
    : [],
)

// Utility functions for doc
const clearCache = () => {
  window.indexedDB.deleteDatabase('fdoc-' + props.file.doc.name)
  window.indexedDB.deleteDatabase('wdoc-comments-' + props.file.doc.name)
}

const navigate = (href) => (window.location.href = href)
</script>
