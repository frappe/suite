<template>
  <nav id="navbar" ondragstart="return false;" ondrop="return false;"
    class="sticky top-0 z-20 bg-surface-base border-b px-5 py-2.5 h-12 shrink-0 flex justify-between">
    <slot name="breadcrumbs">
      <EditableBreadcrumbs :items="breadcrumbItems" :entity="rootEntity || null"
        class="select-none truncate max-w-[80%]" />
    </slot>

    <div class="flex gap-2">
      <div id="navbar-content" class="flex items-center">
        <div class="icon mr-2">
          <LucideGlobe2 v-if="generalAccess === -2" class="size-4" />
          <LucideBuilding2 v-else-if="generalAccess === -1" class="size-4" />
          <LucideUsers v-else-if="generalAccess > 0" class="size-4" />
        </div>
      </div>

      <LucideStar v-if="rootEntity?.is_favourite" width="16" height="16"
        class="my-auto text-ink-amber-6 stroke-current fill-current" />
      <template v-if="!isLoggedIn && !inIframe">
        <Button variant="outline" @click="redirectLogin">Sign In</Button>
        <Button class="hidden md:block" variant="solid" label="Try out Drive"
          @click="open('https://frappecloud.com/dashboard/signup?product=drive')" />
      </template>
      <Dropdown v-else-if="defaultActions" :options="defaultActions" placement="right" :button="{
        variant: 'ghost',
        icon: LucideMoreHorizontal,
        label: 'Entity actions',
      }" />
      <Dropdown v-if="
        ['drive-Folder', 'drive-Home'].includes($route.name) &&
        isLoggedIn &&
        // Nothing of yours to create into on Home's shared tab
        !($route.name === 'drive-Home' && shareView) &&
        // Assume upload to remove flash
        (!props.rootResource?.data || !!props.rootResource.data.upload)
      " :button="{
          variant: 'solid',
          id: 'create-button',
          label: 'Create',
          iconLeft: h(LucidePlus, { class: 'size-4' }),
        }" :options="newEntityOptions" placement="right" />
      <Button v-else-if="$route.name === 'drive-Documents' || $route.name === 'drive-Presentations'" id="create-button"
        label="Create" variant="solid" :icon-left="h(LucidePlus, { class: 'size-4' })"
        @click="newExternal($route.name === 'drive-Documents' ? 'Document' : 'Presentation')" />
      <Button v-if="button" :disabled="!button.entities.data?.length" :theme="button.theme || 'gray'"
        @click="button.onClick">
        <template #prefix>
          <component :is="button.icon" class="size-4" />
        </template>
        {{ button.label }}
      </Button>
    </div>
    <EntityDialogs v-model="entityDialog" :resource="props.rootResource" :entities="dialogEntities" />
  </nav>
</template>
<script setup>
import EntityDialogs from '@/apps/drive/components/EntityDialogs.vue'
import { Button, Dropdown } from 'frappe-ui'
import EditableBreadcrumbs from '@/apps/drive/components/EditableBreadcrumbs.vue'
import { useSessionStore, useCurrentUser } from '@/boot/session'
import { isHomeContext, pageBreadcrumbs } from '@/apps/drive/data/breadcrumbs'
import { shareView } from '@/apps/drive/data/prefs'
import { startRename } from '@/apps/drive/data/selection'
const { systemUser } = useCurrentUser()
import emitter from '@/apps/drive/emitter'
import { ref, computed, inject, h } from 'vue'
import { entitiesDownload } from '@/apps/drive/utils/download'
import { getRecents, getTrash, getFavourites, toggleFav, rootInfo } from '@/apps/drive/resources/files'
import { apps } from '@/apps/drive/resources/permissions'
import { useRoute } from 'vue-router'
import {
  newExternal,
  dynamicList,
  isManaged,
  isAttachmentRef,
  isVirtual,
  openEntity,
} from '@/apps/drive/utils/files'
import { getFileLink } from '@/apps/drive/ui/drive/js/utils'
import {
  confirmRemove,
  confirmClearRecents,
  confirmClearFavourites,
  confirmClearTrash,
} from '@/apps/drive/utils/confirmActions'

import LucideClock from '~icons/lucide/clock'
import LucideHome from '~icons/lucide/home'
import LucideTrash from '~icons/lucide/trash'
import LucideUsers from '~icons/lucide/users'
import LucideBuilding2 from '~icons/lucide/building-2'
import LucideStar from '~icons/lucide/star'
import LucideMoreHorizontal from '~icons/lucide/more-horizontal'
import LucideShare2 from '~icons/lucide/share-2'
import LucideDownload from '~icons/lucide/download'
import LucidePlus from '~icons/lucide/plus'
import LucideLink from '~icons/lucide/link'
import LucideArrowLeftRight from '~icons/lucide/arrow-left-right'
import LucideCornerLeftUp from '~icons/lucide/corner-left-up'
import LucideMonitorCog from '~icons/lucide/monitor-cog'
import LucideSquarePen from '~icons/lucide/square-pen'
import LucideInfo from '~icons/lucide/info'
import LucideFileUp from '~icons/lucide/file-up'
import LucideFolderUp from '~icons/lucide/folder-up'
import LucideFilePlus2 from '~icons/lucide/file-plus-2'
import LucideGalleryVerticalEnd from '~icons/lucide/gallery-vertical-end'
import LucideSheet from '~icons/lucide/sheet'
import LucideFolderPlus from '~icons/lucide/folder-plus'

const route = useRoute()
const open = (url) => {
  window.open(url, '_blank')
}

const props = defineProps({
  rootResource: Object,
  actions: { type: Array, required: false },
  breadcrumbs: {
    type: Array,
    default: null,
  },
  // Used to pass into dialogs
  entities: {
    type: Array,
    default: () => [],
  },
})

const breadcrumbItems = computed(
  () => props.breadcrumbs ?? pageBreadcrumbs.value,
)

const isLoggedIn = computed(() => useSessionStore().isLoggedIn)
const listDialog = inject('listDialog', null)
// Set by GenericPage when Navbar is mounted inside a list context; absent on
// standalone entity pages (e.g. File.vue), where removal just navigates away.
const removeFromList = inject('removeFromList', null)
const entityDialog = ref('')
const rootEntity = computed(() => props.rootResource?.data?.file_name && props.rootResource?.data)
// The shared root is readable by everyone by definition, so the marker there
// says nothing - it's only news on a folder that could have been restricted.
const generalAccess = computed(() =>
  rootEntity.value && rootEntity.value.name !== rootInfo.data?.root
    ? rootEntity.value.share_count
    : null,
)
const dialogEntities = computed(() =>
  props.entities.length ? props.entities : rootEntity.value ? [rootEntity.value] : [],
)

function openListDialog(type) {
  if (listDialog) listDialog.value = type
}

function openEntityDialog(type) {
  entityDialog.value = type
}

function routeDialog(type) {
  if (listDialog) openListDialog(type)
  else openEntityDialog(type)
}

function removeCurrentEntities() {
  const entities = dialogEntities.value
  confirmRemove(entities, {
    onSuccess: () => {
      removeFromList?.(entities)
      const rootDeleted = entities.some((e) => e.name === rootEntity.value?.name)
      if (rootDeleted) {
        openEntity({
          is_folder: 1,
          name: rootEntity.value.folder,
          breadcrumbs: rootEntity.value.breadcrumbs?.slice(0, -1) ?? [],
        })
      }
    },
  })
}

emitter.on('share', () => routeDialog('s'))
// Rename is inline everywhere: a list row in list/grid views, the last
// breadcrumb on an entity page.
emitter.on('rename', () => {
  const target = dialogEntities.value[0]
  if (target) startRename(target.name)
})
emitter.on('remove', removeCurrentEntities)
emitter.on('move', () => routeDialog('m'))
emitter.on('newFolder', () => openListDialog('f'))
emitter.on('newLink', () => openListDialog('l'))

const defaultActions = computed(() => {
  if (!rootEntity.value?.file_name) return
  let actions = []
  if (props.actions) {
    if (props.actions[0] === 'extend') actions = props.actions.slice(1)
    else return props.actions
  }
  return [
    {
      group: true,
      hideLabel: true,
      items: [
        {
          label: __('Open in Desk'),
          icon: LucideMonitorCog,
          onClick: () => window.open('/desk/file/' + rootEntity.value.name, '_blank'),
          isEnabled: () => systemUser.value,
        },
        {
          label: __('Go to original'),
          icon: LucideCornerLeftUp,
          onClick: () => {
            window.open(
              '/api/method/suite.drive.api.files.redirect_to_original?file_id=' + rootEntity.value.name,
              '_blank'
            )
          },
          isEnabled: () => isAttachmentRef(rootEntity.value),
        },
        {
          label: __('Download'),
          icon: LucideDownload,
          isEnabled: () =>
            !isVirtual(rootEntity.value) &&
            !['Link', 'Presentation', 'Document'].includes(rootEntity.value.file_type),
          onClick: () => entitiesDownload([rootEntity.value]),
        },
        {
          label: __('Copy Link'),
          icon: LucideLink,
          onClick: () => getFileLink(rootEntity.value),
        },
        {
          label: __('Show Info'),
          icon: LucideInfo,
          onClick: () => openEntityDialog('i'),
        },
      ],
    },
    {
      group: true,
      hideLabel: true,
      items: [
        {
          label: __('Share'),
          icon: LucideShare2,
          onClick: () => openEntityDialog('s'),
          isEnabled: () => rootEntity.value.share && isManaged(rootEntity.value),
        },
        {
          label: __('Rename'),
          icon: LucideSquarePen,
          onClick: () => startRename(rootEntity.value.name),
          isEnabled: () => rootEntity.value.write && isManaged(rootEntity.value),
        },
        {
          label: __('Move'),
          icon: LucideArrowLeftRight,
          onClick: () => openEntityDialog('m'),
          isEnabled: () => rootEntity.value.write && isManaged(rootEntity.value),
        },
        {
          label: __('Favourite'),
          icon: LucideStar,
          onClick: () => {
            rootEntity.value.is_favourite = true
            toggleFav.submit({
              entities: [{ name: rootEntity.value.name, is_favourite: false }],
            })
          },
          isEnabled: () => !rootEntity.value.is_favourite,
        },
        {
          label: __('Unfavourite'),
          icon: LucideStar,
          color: 'text-ink-amber-6 stroke-current fill-current',
          onClick: () => {
            rootEntity.value.is_favourite = false
            toggleFav.submit({
              entities: [{ name: rootEntity.value.name, is_favourite: false }],
            })
          },
          isEnabled: () => rootEntity.value.is_favourite,
        },
      ],
    },
    {
      group: true,
      hideLabel: true,
      items: [
        {
          label: __('Delete'),
          icon: LucideTrash,
          onClick: removeCurrentEntities,
          isEnabled: () => rootEntity.value.write,
          theme: 'red',
        },
      ],
    },
    ...actions,
  ].map((k) => {
    return { ...k, items: k.items.filter((l) => !l.isEnabled || l.isEnabled()) }
  })
})
const isPrivate = computed(() => (isHomeContext() ? 1 : 0))

// Functions

// Constants
const possibleButtons = [
  {
    route: 'drive-Favourites',
    label: __('Clear'),
    icon: LucideStar,
    entities: getFavourites,
    onClick: confirmClearFavourites,
  },
  {
    route: 'drive-Recents',
    label: __('Clear'),
    icon: LucideClock,
    entities: getRecents,
    onClick: confirmClearRecents,
  },
  {
    route: 'drive-Trash',
    label: __('Empty'),
    icon: LucideTrash,
    entities: getTrash,
    theme: 'red',
    onClick: confirmClearTrash,
  },
]
const button = computed(() => possibleButtons.find((k) => k.route == route.name))

const newEntityOptions = computed(() => [
  {
    group: 'Create',
    items: dynamicList([
      {
        label: 'Document',
        icon: LucideFilePlus2,
        onClick: () => newExternal('Document'),
      },
      {
        label: 'Presentation',
        icon: LucideGalleryVerticalEnd,
        onClick: () => newExternal('Presentation'),
        cond: isPrivate.value && apps.data?.find?.((k) => k.name === 'slides'),
      },
      {
        label: 'Spreadsheet',
        icon: LucideSheet,
        onClick: () => newExternal('Spreadsheet'),
        cond: isPrivate.value && apps.data?.find?.((k) => k.name === 'sheets'),
      },
      {
        label: 'Folder',
        icon: LucideFolderPlus,
        onClick: () => openListDialog('f'),
      },
      {
        label: 'Link',
        icon: LucideLink,
        onClick: () => openListDialog('l'),
      },
    ]),
  },
  {
    group: 'Upload',
    items: [
      {
        label: 'Upload File',
        icon: LucideFileUp,
        onClick: () => emitter.emit('uploadFile'),
      },
      {
        label: 'Upload Folder',
        icon: LucideFolderUp,
        onClick: () => emitter.emit('uploadFolder'),
      },
    ],
  },
])

const inIframe = inject('inIframe')
const redirectLogin = () => {
  window.location.href =
    '/login?redirect-to=' + encodeURIComponent('/drive' + route.path)
}
</script>
