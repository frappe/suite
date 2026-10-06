/** Drive owns link scope, membership, optimism, and reader effects. */
import type { Effects, OwnerRegistration, Policy, TransferContext } from '@/platform/server-state'
import type { Operation, TransferRef } from '@/platform/transport'

import { announceAccessChange } from './accessChanges'
import type { TransferInput } from './api'
import { driveLinks } from './links'
import { transfer } from './uploads'

const LISTS = ['node_children', 'view_list']
const STORAGE = [...LISTS, 'root_usage']
const ACCESS = [
  'node_get',
  'node_grants',
  'view_list',
  'node_children',
  'node_media',
  'node_threads',
  'node_versions',
]
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}
function node(input: unknown): readonly string[] {
  const value = record(input).node
  return typeof value === 'string' ? [value] : []
}
function nodes(input: unknown): readonly string[] {
  const value = record(input).nodes
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}
function scopedNodes(input: unknown): string[] {
  const values = record(input)
  const patch = record(values.patch)
  return [values.node, values.parent_node, patch.parent_node, ...nodes(input)].filter(
    (id): id is string => typeof id === 'string' && id !== '',
  )
}
const access: Effects = {
  touches: node,
  invalidates: ACCESS,
  settled(input) {
    driveLinks.invalidateAccess()
    for (const id of node(input)) announceAccessChange(id)
  },
}
export const mutationEffects: Readonly<Record<string, Effects | 'none'>> = {
  'node_create.create_folder': { invalidates: LISTS },
  'node_create.create_file': { invalidates: STORAGE },
  'node_create.create_link': { invalidates: LISTS },
  'node_create.create_document': { invalidates: LISTS },
  node_batch: { touches: nodes, invalidates: STORAGE },
  node_batch_purge: { touches: nodes, invalidates: STORAGE },
  'node_patch.rename': {
    touches: node,
    invalidates: LISTS,
    optimistic: (input) => ({ title: record(input).title }),
  },
  'node_patch.move': {
    touches: node,
    invalidates: STORAGE,
    optimistic: (input) => ({ parent_node: record(input).parent_node }),
  },
  'node_patch.trash': {
    touches: node,
    invalidates: LISTS,
    optimistic: () => ({ state: 'Trashed' }),
  },
  'node_patch.restore': { touches: node, invalidates: STORAGE },
  'node_patch.stamp': { touches: node, invalidates: LISTS },
  node_purge: { touches: node, invalidates: STORAGE },
  node_copy: { invalidates: STORAGE },
  node_archive_start: { invalidates: ['node_archive_status'] },
  node_put_content: { touches: node, invalidates: [...STORAGE, 'node_versions', 'node_media'] },
  node_preview: { touches: node, invalidates: LISTS },
  // Opening a session reserves storage; chunks only advance that session's bytes.
  upload_create: { invalidates: ['root_usage'] },
  upload_chunk: 'none',
  upload_finish: { invalidates: STORAGE },
  node_visit: { invalidates: ['view_list'] },
  node_put_favourite: {
    touches: node,
    invalidates: ['view_list'],
    optimistic: () => ({ favourite: true }),
  },
  node_delete_favourite: {
    touches: node,
    invalidates: ['view_list'],
    optimistic: () => ({ favourite: false }),
  },
  node_put_grant: access,
  node_delete_grant: access,
  grant_patch: access,
  grant_delete: access,
  grant_rotate: access,
  // unlockNode installs the returned ticket before asking access-sensitive readers to retry.
  link_unlock: 'none',
  view_clear_recents: { invalidates: ['view_list'] },
  node_version_create: { touches: node, invalidates: ['node_versions', 'root_usage'] },
  node_version_patch: { invalidates: ['node_versions'] },
  node_version_delete: { invalidates: ['node_versions', 'root_usage'] },
  node_version_restore: { touches: node, invalidates: [...STORAGE, 'node_versions', 'node_media'] },
  node_thread_create: { invalidates: ['node_threads'] },
  thread_patch: { invalidates: ['node_threads'] },
  thread_comment_create: { invalidates: ['node_threads'] },
  comment_patch: { invalidates: ['node_threads'] },
  comment_delete: { invalidates: ['node_threads'] },
  'notifications_read.notification_names': {
    invalidates: ['notifications_list', 'notifications_unread_count'],
  },
  'notifications_read.all_notifications': {
    invalidates: ['notifications_list', 'notifications_unread_count'],
  },
  'root_patch.root_quota': { invalidates: ['roots_discover', 'root_usage'] },
  'root_patch.root_archive': { invalidates: ['roots_discover', 'root_usage', ...LISTS] },
  root_purge: { invalidates: ['roots_discover', 'root_usage', ...LISTS] },
  root_empty_trash: { invalidates: STORAGE },
  settings_patch: { invalidates: ['settings_get', 'webdav_get'] },
  site_settings_patch: { invalidates: ['site_settings_get', 'settings_get', 'webdav_get'] },
}

export const registration: OwnerRegistration = {
  policy<I, O>(reference: Operation<I, O>): Policy<I, O> {
    const effects = mutationEffects[reference.id]
    if (reference.kind === 'mutation' && effects === undefined)
      throw new TypeError(`Missing Drive effects: ${reference.id}`)
    return {
      partition: (input) => driveLinks.partition(scopedNodes(input)),
      operation(operation) {
        return {
          ...operation,
          scope(input) {
            const values = record(input)
            const ids = scopedNodes(input)
            return driveLinks.scope(ids, {
              returnsNodes: operation.entity?.tag === 'DriveNode',
              subject:
                operation.id === 'node_get' && typeof values.node === 'string'
                  ? values.node
                  : undefined,
            })
          },
        }
      },
      effects,
      ...(reference.id === 'roots_discover' ? { staleTime: 5 * 60_000 } : {}),
      ...(reference.id === 'node_archive_status' ? { refetchInterval: 2_000 } : {}),
      ...(reference.id === 'node_children'
        ? {
            member: (row, input) =>
              row.parent_node === record(input).node && row.state === 'Active',
          }
        : {}),
      ...(reference.id === 'view_list'
        ? {
            member: (row, input) => {
              const values = record(input)
              if (values.view === 'trash')
                return row.state === 'Trashed' && (!values.root || row.root === values.root)
              if (values.view === 'favourites')
                return row.state === 'Active' && row.favourite !== false
              return row.state === 'Active'
            },
          }
        : {}),
    }
  },
  async transfer<I, O>(
    reference: TransferRef<I, O>,
    input: I,
    context: TransferContext,
  ): Promise<O> {
    if (reference.id !== 'uploads.transfer')
      throw new TypeError(`Unknown Drive transfer: ${reference.id}`)
    return (await transfer(input as TransferInput, context)) as O
  },
}
