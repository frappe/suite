<template>
  <nav
    id="navbar"
    ondragstart="return false;"
    ondrop="return false;"
    class="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-outline-elevation-1 bg-surface-elevation-1 px-3"
  >
    <div class="flex min-w-0 items-center gap-2">
      <Dropdown
        :options="navbarMenuOptions"
        :offset="16"
      >
        <template #default="{ open }">
          <div class="flex cursor-pointer items-center gap-2">
            <WriterLogo class="size-7" />
            <LucideChevronUp v-if="open" class="size-4 stroke-[1.5] text-ink-gray-7" />
            <LucideChevronDown v-else class="size-4 stroke-[1.5] text-ink-gray-7" />
          </div>
        </template>
      </Dropdown>
      <slot name="breadcrumbs">
        <TitleBreadcrumbs
          v-if="route.name !== 'writer-home'"
          v-model:editing="renaming"
          :items="formattedCrumbs"
          :title="file?.doc?.file_name ?? ''"
          class="select-none truncate max-w-[80%]"
        />
      </slot>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <div id="navbar-content" class="flex gap-2" />
      <slot name="content" />
      <Button
        v-if="isOffline"
        label="You're offline"
        variant="solid"
        size="sm"
        class="pointer-events-none"
        :icon-left="h(LucideWifiOff, { class: 'size-4' })"
      />
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
        align="end"
        :button="{
          variant: 'ghost',
          icon: LucideMoreHorizontal,
          label: 'Document actions',
        }"
      />
    </div>
    <!-- Kept out of the navbar DOM: the rename field is meant to be the only <input> in there, and e2e locates it as such. -->
    <Teleport to="body">
      <input
        ref="docxInputRef"
        name="docx-import"
        type="file"
        accept=".docx"
        style="display: none"
        @change="onImportDocx"
      />
    </Teleport>
    <Dialogs v-model="dialog" :docs="file?.doc && [file]" />
  </nav>
</template>
<script setup>
import { Button, Dropdown, toast } from 'frappe-ui'
import { setFavourite } from '@/apps/writer/drive'
import TitleBreadcrumbs from '@/apps/writer/components/TitleBreadcrumbs.vue'

import { useSessionStore } from '@/boot/session'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import { useThemeMenuOption } from '@/composables/useThemeMenuOption'
import { useSettingsMenuOption } from '@/composables/useSettingsMenuOption'
import emitter from '@/apps/writer/emitter'
import { ref, computed, inject, h, onBeforeUnmount } from 'vue'
import { createDocument, apps } from '@/apps/writer/resources/'
import { exportBlog } from '@/apps/writer/utils/exports'
import Dialogs from '@/apps/writer/components/Dialogs.vue'
import { dynamicList } from '@/apps/writer/utils/'
import { downloadZippedHTML, downloadMD } from '@/apps/writer/utils'
import { downloadDocxFromHtml } from '../utils/docxexporter'
import { importDocx } from '../utils/docximporter'
import { orderedTabs } from '@/apps/writer/extensions/tabs'
import { createDialog } from '@/apps/writer/utils/dialogs'

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
import LucideUpload from '~icons/lucide/upload'
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
import LucideChevronUp from '~icons/lucide/chevron-up'
import LucideChevronDown from '~icons/lucide/chevron-down'

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
const docxInputRef = ref(null)
const renaming = ref(false)
const startRename = () => {
  if (props.file?.doc?.write) renaming.value = true
}
emitter.on('rename', startRename)
onBeforeUnmount(() => emitter.off('rename', startRename))

const copyLink = () =>
  navigator.clipboard
    .writeText(`${window.location.origin}/writer/w/${props.file.doc.name}`)
    .then(() => toast.success('Copied to your clipboard.'))

const markFavourite = (favourite) => {
  props.file.doc.is_favourite = favourite
  setFavourite(props.file.doc.name, favourite).catch(() => {
    props.file.doc.is_favourite = !favourite
  })
}

const exportDocx = () => {
  if (!editor.value) return
  const filename = `${props.file.doc.file_name}.docx`
  const settings = props.document?.doc?.settings
  const tabs = orderedTabs(editor.value.state.doc)

  if (tabs.length <= 1) {
    downloadDocxFromHtml(editor.value.getHTML(), filename, settings)
    return
  }

  createDialog({
    title: 'Export DOCX',
    message: 'This document has multiple tabs. Export just the current tab, or all of them?',
    actions: [
      {
        label: 'All Tabs',
        variant: 'outline',
        onClick: ({ close }) => {
          downloadDocxFromHtml(editor.value.getHTML(), filename, settings)
          close()
        },
      },
      {
        label: 'Current Tab',
        variant: 'solid',
        onClick: ({ close }) => {
          downloadDocxFromHtml(editor.value.commands.getCurrentTabHTML(), filename, settings)
          close()
        },
      },
    ],
  })
}

const route = useRoute()
const sessionStore = useSessionStore()
const appsMenuOption = useAppSwitcher('writer')
const themeMenuOption = useThemeMenuOption()
const settingsMenuOption = useSettingsMenuOption()
const navbarMenuOptions = computed(() => [
  {
    group: '',
    options: [appsMenuOption.value],
  },
  {
    group: '',
    options: [
      settingsMenuOption,
      themeMenuOption,
      ...(sessionStore.isLoggedIn
        ? [
            {
              label: 'Log out',
              icon: 'lucide-log-out',
              onClick: () => sessionStore.logout.submit(),
            },
          ]
        : []),
    ],
  },
])
const formattedCrumbs = computed(() => {
  const ORIG = { label: 'Writer', href: '/writer' }
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
          group: '',
          hideLabel: true,
          options: [
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
              onClick: copyLink,
            },
          ],
        },
        {
          group: '',
          hideLabel: true,
          options: [
            {
              label: __('Move'),
              icon: LucideArrowLeftRight,
              onClick: () => (dialog.value = 'm'),
              isEnabled: () => props.file.doc.write,
            },
            {
              label: __('Rename'),
              icon: LucideSquarePen,
              onClick: () => emitter.emit('rename'),
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
              onClick: () => markFavourite(true),
              isEnabled: () => isLoggedIn.value && !props.file.doc.is_favourite,
            },
            {
              label: __('Unfavourite'),
              icon: LucideStar,
              color: 'stroke-amber-500 fill-amber-500',
              onClick: () => markFavourite(false),
              isEnabled: () => isLoggedIn.value && props.file.doc.is_favourite,
            },
          ],
        },
        {
          group: '',
          hideLabel: true,
          options: dynamicList([
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
                  onClick: () => exportDocx(),
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
              label: 'Import',
              icon: LucideUpload,
              cond: props.file.doc.write,
              submenu: [
                {
                  label: 'DOCX',
                  icon: LucideFileText,
                  onClick: () => docxInputRef.value?.click(),
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
          group: '',
          hideLabel: true,
          options: [
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
          options: k.options.filter((l) => !l.isEnabled || l.isEnabled()),
        }
      })
    : [],
)

const onImportDocx = async (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  await importDocx(file, { editor, currentFileId: props.file.doc.name })
}

// Utility functions for doc
const clearCache = () => {
  window.indexedDB.deleteDatabase('fdoc-' + props.file.doc.name)
  window.indexedDB.deleteDatabase('wdoc-comments-' + props.file.doc.name)
}

const navigate = (href) => (window.location.href = href)
</script>
