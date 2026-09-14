import { dialog, call, toast } from 'frappe-ui'
import { useTimeAgo } from '@vueuse/core'
import { getTrash, toggleFav, clearRecent, clearTrash } from '@/apps/drive/resources/files.js'
import { sortEntities } from '@/apps/drive/utils/files.js'

function itemString(entities) {
  return entities.length === 1 ? 'an item' : `${entities.length} items`
}

function entityLabel(entities) {
  return entities.length > 1 ? 'These items' : `"${entities[0].file_name}"`
}

function entityNames(entities) {
  return JSON.stringify(entities.map((entity) => entity.name))
}

export function confirmRestore(entities, { onSuccess } = {}) {
  const label = itemString(entities)
  dialog.confirm({
    title: `Restore ${label}`,
    message: `${entityLabel(entities)} will be restored to ${
      entities.length === 1 ? 'its original location' : 'their original locations'
    }.`,
    confirmLabel: 'Restore',
    onConfirm: async () => {
      await call('suite.drive.api.files.remove_or_restore', {
        entity_names: entityNames(entities),
      })
      const names = entities.map((entity) => entity.name)
      getTrash.setData((d) => (d ?? []).filter((k) => !names.includes(k.name)))
      toast.success(`Restored ${label}.`)
      onSuccess?.()
    },
  })
}

export function confirmRemove(entities, { onSuccess } = {}) {
  const label = itemString(entities)
  dialog.confirm({
    title: `Move ${label} to Trash`,
    message: `${entityLabel(entities)} will be moved to Trash. Items in trash are deleted forever after 30 days.`,
    confirmLabel: 'Move to Trash',
    theme: 'red',
    onConfirm: async () => {
      await call('suite.drive.api.files.remove_or_restore', {
        entity_names: entityNames(entities),
      })
      // Only patch the trash cache if it was ever fetched — `data` is null
      // until the user opens Trash, and spreading that throws.
      if (getTrash.data)
        getTrash.setData(
          sortEntities([
            ...getTrash.data,
            ...entities.map((entity) => {
              entity.modified = Date()
              entity.relativeModified = useTimeAgo(entity.modified)
              return entity
            }),
          ]),
        )
      toast.success(`Moved ${label} to Trash.`)
      onSuccess?.()
    },
  })
}

export function confirmDeleteForever(entities, { onSuccess } = {}) {
  const label = itemString(entities)
  dialog.danger({
    title: `Delete ${label}`,
    message: `${entityLabel(entities)} will be deleted — you can no longer access it. This is an irreversible action.`,
    confirmLabel: 'Delete forever',
    onConfirm: async () => {
      await call('suite.drive.api.files.delete_entities', {
        entity_names: entityNames(entities),
      })
      toast.success(`Deleted ${label}.`)
      onSuccess?.()
    },
  })
}

export function confirmClearRecents() {
  dialog.confirm({
    title: 'Are you sure?',
    message: 'All your recently viewed files will be cleared.',
    confirmLabel: 'Clear',
    onConfirm: async () => {
      await clearRecent.submit()
    },
  })
}

export function confirmClearFavourites() {
  dialog.confirm({
    title: 'Are you sure?',
    message: 'All your favourite items will be cleared.',
    confirmLabel: 'Clear',
    onConfirm: async () => {
      await toggleFav.submit()
    },
  })
}

export function confirmClearTrash() {
  dialog.danger({
    title: 'Clear your Trash',
    message: 'All items in your Trash will be deleted forever. This is an irreversible process.',
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await clearTrash.submit()
    },
  })
}
