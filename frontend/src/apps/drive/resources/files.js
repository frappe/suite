import { createResource } from 'frappe-ui'
import { toast } from '@/apps/drive/utils/toasts'
import { openEntity, setTitle } from '@/apps/drive/utils/files'
import { activeEntity } from '@/apps/drive/data/selection'
import { renameCrumbEntity } from '@/apps/drive/data/breadcrumbs'
import { getSortOrder } from '@/apps/drive/data/prefs'
import {
  prettyData,
  setCache,
  PRESENTATION_CONTENT_DOCTYPE,
} from '@/apps/drive/utils/files'
import { updateURLSlug } from '@/apps/drive/utils/files'

// GETTERS
export const PAGE_SIZE = 50

export const COMMON_OPTIONS = {
  method: 'GET',
  debounce: 500,
  transform(data) {
    return prettyData(data.filter((k) => !k.file_name?.startsWith('.')))
  },
}

export const getFiles = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.files',
  makeParams: (params) => {
    return params
  },
  cache: 'folder-contents',
})

// The site root and the current user's private folder
export const rootInfo = createResource({
  url: 'suite.drive.api.files.get_root_folder',
  method: 'GET',
  cache: 'root-info',
})

export const getRecents = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.recents',
  cache: 'recents-folder-contents'
})

export const getPersonal = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.files',
  cache: 'personal-folder-contents',
  makeParams: (params) => params,
})

export const getAttachments = createResource({
  url: 'suite.drive.api.list.get_attachments',
  makeParams: (params) => params,
  cache: 'attachments-folder-contents',
})

export const getFavourites = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.favourites',
  cache: 'favourite-folder-contents',
})

export const getDocuments = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.files',
  makeParams: (params) => {
    return { ...params, file_kinds: '["Frappe Document"]' }
  },
  cache: 'document-folder-contents',
})

export const getSlides = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.slides.doctype.presentation.presentation.get_presentations',
  cache: 'slides-folder-contents',
  transform(data) {
    data = data.map((k) => ({
      ...k,
      file_name: k.title,
      content_doctype: PRESENTATION_CONTENT_DOCTYPE,
      content_docname: k.name,
      mime_type: 'frappe/slides',
      file_type: 'Presentation',
      path: k.name,
      external: true,
      file_size: 0,
    }))
    prettyData(data)
    return data
  },
})

export const getShared = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.shared',
  cache: 'shared-folder-contents',
  makeParams: (params) => {
    return { shared_type: 'with', ...params }
  },
})

export const getTrash = createResource({
  ...COMMON_OPTIONS,
  url: 'suite.drive.api.list.trash',
  cache: 'trash-folder-contents',
  makeParams: (params) => {
    return { ...params }
  },
})

;[
  getFiles,
  getPersonal,
  getRecents,
  getFavourites,
  getDocuments,
  getShared,
  getTrash,
].forEach((r) => (r.paginated = true))

// SETTERS
export const LISTS = [
  getPersonal,
  getFiles,
  getRecents,
  getShared,
  getFavourites,
]
export const mutate = (entities, func) => {
  LISTS.forEach((l) =>
    l.setData((d) => {
      if (!d) return
      entities.forEach(({ name, ...params }) => {
        let el = d.find((k) => k.name === name)
        if (el) {
          func(el, params)
        }
      })
      return d
    })
  )
}

export const updateMoved = (new_parent) => {
  // All details are repetetively provided (check Folder.vue) because if this is run first
  // No further mutation of the resource object can take place
  createResource({
    ...COMMON_OPTIONS,
    url: 'suite.drive.api.list.files',
    makeParams: (params) => ({
      ...params,
      entity_name: new_parent,
    }),
    cache: ['folder', new_parent],
  }).fetch(
    (() => {
      const order = getSortOrder(new_parent)
      return order
        ? {
            order_by: order.field,
            ascending: order.ascending,
          }
        : {}
    })()
  )
}

export const toggleFav = createResource({
  url: 'suite.drive.api.files.set_favourite',
  makeParams(data) {
    if (!data) {
      getFavourites.setData([])
      mutate(getFavourites.data, (el) => (el.is_favourite = false))
      return { clear_all: true }
    }
    const entity_names = data.entities.map(({ name }) => name)
    getFavourites.setData((d) => {
      return data.entities[0].is_favourite
        ? [...(d ?? []), ...data.entities]
        : (d ?? []).filter(({ name }) => !entity_names.includes(name))
    })
    mutate(
      data.entities,
      (el, { is_favourite }) => (el.is_favourite = is_favourite)
    )
    return {
      entities: data.entities,
    }
  },
  onSuccess() {
    if (!toggleFav.params.entities) toast('All favourites cleared')
    if (toggleFav.params.entities.length === 1) return
    if (toggleFav.params.entities[0].is_favourite === false)
      toast(`${toggleFav.params.entities.length} items unfavourited`)
    else toast(`${toggleFav.params.entities.length} items favourited`)
  },
  onError() {
    if (toggleFav.params?.entities) {
      const reverted = toggleFav.params.entities.map((e) => ({
        ...e,
        is_favourite: !e.is_favourite,
      }))
      getFavourites.setData((d) => {
        const names = reverted.map((r) => r.name)
        return reverted[0].is_favourite
          ? [...(d ?? []), ...reverted]
          : (d ?? []).filter(({ name }) => !names.includes(name))
      })
      mutate(reverted, (el, { is_favourite }) => (el.is_favourite = is_favourite))
    }
    toast.error('Failed to update favourite status')
  },
})

export const clearRecent = createResource({
  url: 'suite.drive.api.files.remove_recents',
  makeParams: (data) => {
    if (!data) {
      getRecents.setData([])
      return { clear_all: true }
    }
    const entity_names = data.entities.map(({ name }) => name)
    getRecents.setData((d) =>
      d.filter(({ name }) => !entity_names.includes(name))
    )
    return {
      entity_names,
    }
  },
  onError: () => {
    toast.error('There was an error while clearing recents.')
  },
})

export const clearTrash = createResource({
  url: 'suite.drive.api.files.delete_entities',
  makeParams: (data) => {
    if (!data) {
      getTrash.setData([])
      return { clear_all: true }
    }
    return { entity_names: data.entities.map((e) => e.name) }
  },
  onSuccess: () => {
    // Buggy for some reason
    const files = clearTrash.params.entity_names?.length
    toast(
      `Permanently deleted ${files || 'all'} file${files === 1 ? '' : 's'}.`
    )
  },
  onError(error) {
    toast.error(JSON.stringify(error))
  },
})

export const rename = createResource({
  url: 'suite.drive.api.files.rename',
  method: 'POST',
  makeParams: (data) => {
    return {
      ...data,
    }
  },
  onSuccess: () => {
    renameCrumbEntity(rename.params.entity_name, rename.params.new_title)
    if (activeEntity.value?.name === rename.params.entity_name) {
      activeEntity.value.file_name = rename.params.new_title
      activeEntity.value.modified = new Date()
    }
    setTitle(rename.params.new_title)
    updateURLSlug(rename.params.new_title)
  },
  onError(error) {
    toast.error(error.messages[error.messages.length - 1], { duration: 2000 })
  },
})

export const createDocument = createResource({
  method: 'POST',
  url: 'suite.writer.api.docs.create_document',
  makeParams: (params) => params,
})

export const createSheet = createResource({
  method: 'POST',
  url: 'suite.sheets.api.create_sheet',
  makeParams: (params) => params,
})


export const move = createResource({
  url: 'suite.drive.api.files.move',
  onSuccess(data) {
    toast('Moved to ' + data.file_name, {
      action: {
        label: 'Go',
        onClick: () => openEntity({ name: data.name, is_folder: true }),
      },
    })

    // Update moved-into folder
    updateMoved(data.name)
  },
  onError(error) {
    toast.error(error?.messages?.at(-1) || 'Could not move this file.')
  },
})

export const translate = createResource({
  method: 'GET',
  url: '/api/method/suite.drive.api.files.translate_old_name',
})

export const storageBar = createResource({
  url: 'suite.drive.api.storage.storage_bar_data',
  method: 'GET',
  cache: 'total_storage',
})

setCache(getFiles, 'home-folder-contents')
setCache(getShared, 'shared-folder-contents')
setCache(getRecents, 'recents-folder-contents')
setCache(getFavourites, 'favourite-folder-contents')
setCache(getPersonal, 'personal-folder-contents')
setCache(getTrash, 'trash-folder-contents')
setCache(getDocuments, 'document-folder-contents')
