// Generated from src/apps/drive/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type NodeCreateCreateFolderOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeCreateCreateFolderOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
}

export type NodeCreateCreateFolderOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodeCreateCreateFolderOutputPreviewShape = { url: string; expires: number }

export type NodeCreateCreateFolderInput = { kind: 'folder'; parent_node: string; title: string }

export type NodeCreateCreateFolderOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeCreateCreateFolderOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeCreateCreateFolderOutputAccessShape
  breadcrumbs?: Array<NodeCreateCreateFolderOutputBreadcrumbShape>
  preview?: NodeCreateCreateFolderOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeCreateCreateFolderError = 'DriveForbidden' | 'DriveConflict' | 'DriveOverQuota'

const operationNodeCreateCreateFolder: MutationRef<
  NodeCreateCreateFolderInput,
  NodeCreateCreateFolderOutput,
  NodeCreateCreateFolderError
> = {
  id: 'node_create.create_folder',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.createFolder',
  method: 'POST',
  path: 'nodes',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveForbidden', 'DriveConflict', 'DriveOverQuota'],
  loadValidators: async () => (await import('./validators')).operationNodeCreateCreateFolder,
}

export type NodeCreateCreateFileOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeCreateCreateFileOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
}

export type NodeCreateCreateFileOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodeCreateCreateFileOutputPreviewShape = { url: string; expires: number }

export type NodeCreateCreateFileInput = {
  kind: 'file'
  parent_node: string
  title: string
  blob: string
  size: number
  mime: string
  content_modified?: string
}

export type NodeCreateCreateFileOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeCreateCreateFileOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeCreateCreateFileOutputAccessShape
  breadcrumbs?: Array<NodeCreateCreateFileOutputBreadcrumbShape>
  preview?: NodeCreateCreateFileOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeCreateCreateFileError = 'DriveForbidden' | 'DriveConflict' | 'DriveOverQuota'

const operationNodeCreateCreateFile: MutationRef<
  NodeCreateCreateFileInput,
  NodeCreateCreateFileOutput,
  NodeCreateCreateFileError
> = {
  id: 'node_create.create_file',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.createFile',
  method: 'POST',
  path: 'nodes',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveForbidden', 'DriveConflict', 'DriveOverQuota'],
  loadValidators: async () => (await import('./validators')).operationNodeCreateCreateFile,
}

export type NodeCreateCreateLinkOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeCreateCreateLinkOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
}

export type NodeCreateCreateLinkOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodeCreateCreateLinkOutputPreviewShape = { url: string; expires: number }

export type NodeCreateCreateLinkInput = {
  kind: 'link'
  parent_node: string
  title: string
  url: string
}

export type NodeCreateCreateLinkOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeCreateCreateLinkOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeCreateCreateLinkOutputAccessShape
  breadcrumbs?: Array<NodeCreateCreateLinkOutputBreadcrumbShape>
  preview?: NodeCreateCreateLinkOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeCreateCreateLinkError = 'DriveForbidden' | 'DriveConflict' | 'DriveOverQuota'

const operationNodeCreateCreateLink: MutationRef<
  NodeCreateCreateLinkInput,
  NodeCreateCreateLinkOutput,
  NodeCreateCreateLinkError
> = {
  id: 'node_create.create_link',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.createLink',
  method: 'POST',
  path: 'nodes',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveForbidden', 'DriveConflict', 'DriveOverQuota'],
  loadValidators: async () => (await import('./validators')).operationNodeCreateCreateLink,
}

export type NodeCreateCreateDocumentOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeCreateCreateDocumentOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
}

export type NodeCreateCreateDocumentOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodeCreateCreateDocumentOutputPreviewShape = { url: string; expires: number }

export type NodeCreateCreateDocumentInput = {
  kind: 'document'
  parent_node: string
  title: string
  content_doctype: string
  from_node?: string
  is_template?: boolean
}

export type NodeCreateCreateDocumentOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeCreateCreateDocumentOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeCreateCreateDocumentOutputAccessShape
  breadcrumbs?: Array<NodeCreateCreateDocumentOutputBreadcrumbShape>
  preview?: NodeCreateCreateDocumentOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeCreateCreateDocumentError = 'DriveForbidden' | 'DriveConflict' | 'DriveOverQuota'

const operationNodeCreateCreateDocument: MutationRef<
  NodeCreateCreateDocumentInput,
  NodeCreateCreateDocumentOutput,
  NodeCreateCreateDocumentError
> = {
  id: 'node_create.create_document',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.createDocument',
  method: 'POST',
  path: 'nodes',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveForbidden', 'DriveConflict', 'DriveOverQuota'],
  loadValidators: async () => (await import('./validators')).operationNodeCreateCreateDocument,
}

export type NodeBatchInputBatchPatch = {
  title?: string
  parent_node?: string
  expect_parent_node?: string
  state?: 'Active' | 'Trashed'
  content_modified?: string
}

export type NodeBatchOutputBatchFailure = { node: string; type: string; message: string }

export type NodeBatchInput = { nodes: Array<string>; patch: NodeBatchInputBatchPatch }

export type NodeBatchOutput = { ok: Array<string>; failed: Array<NodeBatchOutputBatchFailure> }

export type NodeBatchError = never

const operationNodeBatch: MutationRef<NodeBatchInput, NodeBatchOutput, NodeBatchError> = {
  id: 'node_batch',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.batch',
  method: 'POST',
  path: 'nodes/batch',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationNodeBatch,
}

export type NodeBatchPurgeOutputBatchFailure = { node: string; type: string; message: string }

export type NodeBatchPurgeInput = { nodes: Array<string> }

export type NodeBatchPurgeOutput = {
  ok: Array<string>
  failed: Array<NodeBatchPurgeOutputBatchFailure>
}

export type NodeBatchPurgeError = never

const operationNodeBatchPurge: MutationRef<
  NodeBatchPurgeInput,
  NodeBatchPurgeOutput,
  NodeBatchPurgeError
> = {
  id: 'node_batch_purge',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.purgeBatch',
  method: 'POST',
  path: 'nodes/batch/purge',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationNodeBatchPurge,
}

export type NodeGetOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeGetOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodeGetOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodeGetOutputPreviewShape = { url: string; expires: number }

export type NodeGetInput = { expand?: string; node: string }

export type NodeGetOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeGetOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeGetOutputAccessShape
  breadcrumbs?: Array<NodeGetOutputBreadcrumbShape>
  preview?: NodeGetOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeGetError = 'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired'

const operationNodeGet: QueryRef<NodeGetInput, NodeGetOutput, NodeGetError> = {
  id: 'node_get',
  owner: 'drive',
  kind: 'query',
  publicName: 'nodes.get',
  method: 'GET',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired'],
  loadValidators: async () => (await import('./validators')).operationNodeGet,
}

export type NodePatchRenameOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodePatchRenameOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodePatchRenameOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodePatchRenameOutputPreviewShape = { url: string; expires: number }

export type NodePatchRenameInput = { title: string; node: string }

export type NodePatchRenameOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodePatchRenameOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodePatchRenameOutputAccessShape
  breadcrumbs?: Array<NodePatchRenameOutputBreadcrumbShape>
  preview?: NodePatchRenameOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodePatchRenameError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveMoved'
  | 'DriveRestoreDestinationRequired'
  | 'DriveOverQuota'

const operationNodePatchRename: MutationRef<
  NodePatchRenameInput,
  NodePatchRenameOutput,
  NodePatchRenameError
> = {
  id: 'node_patch.rename',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.rename',
  method: 'PATCH',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveMoved',
    'DriveRestoreDestinationRequired',
    'DriveOverQuota',
  ],
  loadValidators: async () => (await import('./validators')).operationNodePatchRename,
}

export type NodePatchMoveOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodePatchMoveOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodePatchMoveOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodePatchMoveOutputPreviewShape = { url: string; expires: number }

export type NodePatchMoveInput = { parent_node: string; expect_parent_node?: string; node: string }

export type NodePatchMoveOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodePatchMoveOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodePatchMoveOutputAccessShape
  breadcrumbs?: Array<NodePatchMoveOutputBreadcrumbShape>
  preview?: NodePatchMoveOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodePatchMoveError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveMoved'
  | 'DriveRestoreDestinationRequired'
  | 'DriveOverQuota'

const operationNodePatchMove: MutationRef<
  NodePatchMoveInput,
  NodePatchMoveOutput,
  NodePatchMoveError
> = {
  id: 'node_patch.move',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.move',
  method: 'PATCH',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveMoved',
    'DriveRestoreDestinationRequired',
    'DriveOverQuota',
  ],
  loadValidators: async () => (await import('./validators')).operationNodePatchMove,
}

export type NodePatchTrashOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodePatchTrashOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodePatchTrashOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodePatchTrashOutputPreviewShape = { url: string; expires: number }

export type NodePatchTrashInput = { state: 'Trashed'; node: string }

export type NodePatchTrashOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodePatchTrashOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodePatchTrashOutputAccessShape
  breadcrumbs?: Array<NodePatchTrashOutputBreadcrumbShape>
  preview?: NodePatchTrashOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodePatchTrashError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveMoved'
  | 'DriveRestoreDestinationRequired'
  | 'DriveOverQuota'

const operationNodePatchTrash: MutationRef<
  NodePatchTrashInput,
  NodePatchTrashOutput,
  NodePatchTrashError
> = {
  id: 'node_patch.trash',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.trash',
  method: 'PATCH',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveMoved',
    'DriveRestoreDestinationRequired',
    'DriveOverQuota',
  ],
  loadValidators: async () => (await import('./validators')).operationNodePatchTrash,
}

export type NodePatchRestoreOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodePatchRestoreOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodePatchRestoreOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodePatchRestoreOutputPreviewShape = { url: string; expires: number }

export type NodePatchRestoreInput = { state: 'Active'; parent_node?: string; node: string }

export type NodePatchRestoreOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodePatchRestoreOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodePatchRestoreOutputAccessShape
  breadcrumbs?: Array<NodePatchRestoreOutputBreadcrumbShape>
  preview?: NodePatchRestoreOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodePatchRestoreError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveMoved'
  | 'DriveRestoreDestinationRequired'
  | 'DriveOverQuota'

const operationNodePatchRestore: MutationRef<
  NodePatchRestoreInput,
  NodePatchRestoreOutput,
  NodePatchRestoreError
> = {
  id: 'node_patch.restore',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.restore',
  method: 'PATCH',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveMoved',
    'DriveRestoreDestinationRequired',
    'DriveOverQuota',
  ],
  loadValidators: async () => (await import('./validators')).operationNodePatchRestore,
}

export type NodePatchStampOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodePatchStampOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodePatchStampOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodePatchStampOutputPreviewShape = { url: string; expires: number }

export type NodePatchStampInput = { content_modified: string; node: string }

export type NodePatchStampOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodePatchStampOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodePatchStampOutputAccessShape
  breadcrumbs?: Array<NodePatchStampOutputBreadcrumbShape>
  preview?: NodePatchStampOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodePatchStampError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveMoved'
  | 'DriveRestoreDestinationRequired'
  | 'DriveOverQuota'

const operationNodePatchStamp: MutationRef<
  NodePatchStampInput,
  NodePatchStampOutput,
  NodePatchStampError
> = {
  id: 'node_patch.stamp',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.stamp',
  method: 'PATCH',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveMoved',
    'DriveRestoreDestinationRequired',
    'DriveOverQuota',
  ],
  loadValidators: async () => (await import('./validators')).operationNodePatchStamp,
}

export type NodePurgeInput = { node: string }

export type NodePurgeOutput = { count: number }

export type NodePurgeError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodePurge: MutationRef<NodePurgeInput, NodePurgeOutput, NodePurgeError> = {
  id: 'node_purge',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.purge',
  method: 'DELETE',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodePurge,
}

export type NodeChildrenOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeChildrenOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodeChildrenOutputNodeShape = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeChildrenOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeChildrenOutputAccessShape
  breadcrumbs?: Array<NodeChildrenOutputBreadcrumbShape>
  preview?: NodeChildrenOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeChildrenOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodeChildrenOutputPreviewShape = { url: string; expires: number }

export type NodeChildrenInput = {
  limit?: number
  cursor?: string
  order_by?: string
  ascending?: boolean
  type?: string
  expand?: string
  node: string
}

export type NodeChildrenOutput = {
  rows: Array<NodeChildrenOutputNodeShape>
  next_cursor: string | null
}

export type NodeChildrenError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeChildren: PageRef<
  NodeChildrenInput,
  NodeChildrenOutputNodeShape,
  NodeChildrenError,
  NodeChildrenOutput
> = {
  id: 'node_children',
  owner: 'drive',
  kind: 'query',
  publicName: 'nodes.children',
  page: { cursor: 'cursor', rows: 'rows', next: 'next_cursor' },
  method: 'GET',
  path: 'nodes/{node}/children',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeChildren,
}

export type NodeCopyOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodeCopyOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodeCopyOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodeCopyOutputPreviewShape = { url: string; expires: number }

export type NodeCopyInput = { parent_node: string; title?: string; node: string }

export type NodeCopyOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodeCopyOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodeCopyOutputAccessShape
  breadcrumbs?: Array<NodeCopyOutputBreadcrumbShape>
  preview?: NodeCopyOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodeCopyError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveOverQuota'

const operationNodeCopy: MutationRef<NodeCopyInput, NodeCopyOutput, NodeCopyError> = {
  id: 'node_copy',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.copy',
  method: 'POST',
  path: 'nodes/{node}/copy',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveOverQuota',
  ],
  loadValidators: async () => (await import('./validators')).operationNodeCopy,
}

export type NodeArchiveStartInput = { node: string }

export type NodeArchiveStartOutput = {
  status: 'building' | 'ready' | 'failed'
  file_name: string | null
  size: number | null
  error: string | null
}

export type NodeArchiveStartError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeArchiveStart: MutationRef<
  NodeArchiveStartInput,
  NodeArchiveStartOutput,
  NodeArchiveStartError
> = {
  id: 'node_archive_start',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'archives.start',
  method: 'POST',
  path: 'nodes/{node}/archive',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeArchiveStart,
}

export type NodeArchiveStatusInput = { node: string }

export type NodeArchiveStatusOutput = {
  status: 'building' | 'ready' | 'failed'
  file_name: string | null
  size: number | null
  error: string | null
}

export type NodeArchiveStatusError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeArchiveStatus: QueryRef<
  NodeArchiveStatusInput,
  NodeArchiveStatusOutput,
  NodeArchiveStatusError
> = {
  id: 'node_archive_status',
  owner: 'drive',
  kind: 'query',
  publicName: 'archives.get',
  method: 'GET',
  path: 'nodes/{node}/archive',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeArchiveStatus,
}

export type NodeArchiveDownloadInput = { node: string }

export type NodeArchiveDownloadOutput = Blob

export type NodeArchiveDownloadError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeArchiveDownload: QueryRef<
  NodeArchiveDownloadInput,
  NodeArchiveDownloadOutput,
  NodeArchiveDownloadError
> = {
  id: 'node_archive_download',
  owner: 'drive',
  kind: 'query',
  publicName: 'archives.download',
  bytes: true,
  method: 'GET',
  path: 'nodes/{node}/archive/download',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeArchiveDownload,
}

export type NodePutContentOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type NodePutContentOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type NodePutContentOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodePutContentOutputPreviewShape = { url: string; expires: number }

export type NodePutContentInput = {
  upload_id: string
  checksum?: string
  content_modified?: string
  node: string
}

export type NodePutContentOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: NodePutContentOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: NodePutContentOutputAccessShape
  breadcrumbs?: Array<NodePutContentOutputBreadcrumbShape>
  preview?: NodePutContentOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type NodePutContentError =
  | 'DriveNotFound'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'DriveForbidden'
  | 'DriveConflict'
  | 'DriveOverQuota'
  | 'DriveFileTooLarge'

const operationNodePutContent: MutationRef<
  NodePutContentInput,
  NodePutContentOutput,
  NodePutContentError
> = {
  id: 'node_put_content',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.replaceContent',
  method: 'PUT',
  path: 'nodes/{node}/content',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: [
    'DriveNotFound',
    'DriveLocked',
    'DriveLinkExpired',
    'DriveForbidden',
    'DriveConflict',
    'DriveOverQuota',
    'DriveFileTooLarge',
  ],
  loadValidators: async () => (await import('./validators')).operationNodePutContent,
}

export type NodeGetContentInput = { format?: string; download?: boolean; node: string }

export type NodeGetContentOutput = Blob

export type NodeGetContentError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeGetContent: QueryRef<
  NodeGetContentInput,
  NodeGetContentOutput,
  NodeGetContentError
> = {
  id: 'node_get_content',
  owner: 'drive',
  kind: 'query',
  publicName: 'nodes.download',
  bytes: true,
  method: 'GET',
  path: 'nodes/{node}/content',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeGetContent,
}

export type NodeMediaOutputMediaItem = {
  node: string
  title: string
  mime: string | null
  size: number
  url: string
  expires: number
}

export type NodeMediaInput = { node: string }

export type NodeMediaOutput = { media: Array<NodeMediaOutputMediaItem> }

export type NodeMediaError = 'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeMedia: QueryRef<NodeMediaInput, NodeMediaOutput, NodeMediaError> = {
  id: 'node_media',
  owner: 'drive',
  kind: 'query',
  publicName: 'nodes.media',
  method: 'GET',
  path: 'nodes/{node}/media',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeMedia,
}

export type NodePreviewOutputPreviewShape = { url: string; expires: number }

export type NodePreviewInput = { image: string; mime: string; node: string }

export type NodePreviewOutput = { preview: NodePreviewOutputPreviewShape | null }

export type NodePreviewError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden'

const operationNodePreview: MutationRef<NodePreviewInput, NodePreviewOutput, NodePreviewError> = {
  id: 'node_preview',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.setPreview',
  method: 'POST',
  path: 'nodes/{node}/preview',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationNodePreview,
}

export type UploadCreateOutputChunkedUpload = { upload_id: string; mode: 'chunked' }

export type UploadCreateOutputDirectUpload = {
  upload_id: string
  mode: 'direct'
  url: string
  fields: { [key: string]: string }
}

export type UploadCreateInput = {
  parent_node: string
  filename: string
  size: number
  mime?: string
  replaces?: string
}

export type UploadCreateOutput = UploadCreateOutputChunkedUpload | UploadCreateOutputDirectUpload

export type UploadCreateError =
  'DriveNotFound' | 'DriveForbidden' | 'DriveConflict' | 'DriveOverQuota' | 'DriveFileTooLarge'

const operationUploadCreate: MutationRef<UploadCreateInput, UploadCreateOutput, UploadCreateError> =
  {
    id: 'upload_create',
    owner: 'drive',
    kind: 'mutation',
    publicName: 'uploads.create',
    method: 'POST',
    path: 'uploads',
    prefix: '/api/suite/drive/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: [
      'DriveNotFound',
      'DriveForbidden',
      'DriveConflict',
      'DriveOverQuota',
      'DriveFileTooLarge',
    ],
    loadValidators: async () => (await import('./validators')).operationUploadCreate,
  }

export type UploadChunkInput = { offset: number; upload_id: string; chunk: unknown } & {
  chunk: Blob
}

export type UploadChunkOutput = { upload_id: string; received: number }

export type UploadChunkError =
  'DriveNotFound' | 'DriveForbidden' | 'DriveConflict' | 'DriveFileTooLarge'

const operationUploadChunk: MutationRef<UploadChunkInput, UploadChunkOutput, UploadChunkError> = {
  id: 'upload_chunk',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'uploads.chunk',
  method: 'PUT',
  path: 'uploads/{upload_id}/chunk',
  prefix: '/api/suite/drive/',
  pathParams: ['upload_id'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict', 'DriveFileTooLarge'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationUploadChunk,
}

export type UploadFinishOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type UploadFinishOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type UploadFinishOutputPerson = { id: string; full_name: string; user_image: string | null }

export type UploadFinishOutputPreviewShape = { url: string; expires: number }

export type UploadFinishInput = {
  parent_node?: string
  title?: string
  replaces?: string
  checksum?: string
  content_modified?: string
  upload_id: string
}

export type UploadFinishOutput = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: UploadFinishOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: UploadFinishOutputAccessShape
  breadcrumbs?: Array<UploadFinishOutputBreadcrumbShape>
  preview?: UploadFinishOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type UploadFinishError =
  'DriveNotFound' | 'DriveForbidden' | 'DriveConflict' | 'DriveOverQuota' | 'DriveFileTooLarge'

const operationUploadFinish: MutationRef<UploadFinishInput, UploadFinishOutput, UploadFinishError> =
  {
    id: 'upload_finish',
    owner: 'drive',
    kind: 'mutation',
    publicName: 'uploads.finish',
    method: 'POST',
    path: 'uploads/{upload_id}/finish',
    prefix: '/api/suite/drive/',
    pathParams: ['upload_id'],
    nodeParams: [],
    entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
    errors: [
      'DriveNotFound',
      'DriveForbidden',
      'DriveConflict',
      'DriveOverQuota',
      'DriveFileTooLarge',
    ],
    loadValidators: async () => (await import('./validators')).operationUploadFinish,
  }

export type NodeActivityOutputActivityShape = {
  name: string
  node: string
  action: string
  actor: string
  at: string | null
  via_link: string | null
  client: string | null
  detail: { [key: string]: unknown }
}

export type NodeActivityInput = { limit?: number; cursor?: string; node: string }

export type NodeActivityOutput = {
  rows: Array<NodeActivityOutputActivityShape>
  next_cursor: string | null
}

export type NodeActivityError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeActivity: PageRef<
  NodeActivityInput,
  NodeActivityOutputActivityShape,
  NodeActivityError,
  NodeActivityOutput
> = {
  id: 'node_activity',
  owner: 'drive',
  kind: 'query',
  publicName: 'nodes.activity',
  page: { cursor: 'cursor', rows: 'rows', next: 'next_cursor' },
  method: 'GET',
  path: 'nodes/{node}/activity',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeActivity,
}

export type NodeVisitInput = { node: string }

export type NodeVisitOutput = { count: number }

export type NodeVisitError = 'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeVisit: MutationRef<NodeVisitInput, NodeVisitOutput, NodeVisitError> = {
  id: 'node_visit',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.visit',
  method: 'POST',
  path: 'nodes/{node}/visit',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVisit,
}

export type NodePutFavouriteInput = { node: string }

export type NodePutFavouriteOutput = { count: number }

export type NodePutFavouriteError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden'

const operationNodePutFavourite: MutationRef<
  NodePutFavouriteInput,
  NodePutFavouriteOutput,
  NodePutFavouriteError
> = {
  id: 'node_put_favourite',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.star',
  method: 'PUT',
  path: 'nodes/{node}/favourite',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationNodePutFavourite,
}

export type NodeDeleteFavouriteInput = { node: string }

export type NodeDeleteFavouriteOutput = { count: number }

export type NodeDeleteFavouriteError = 'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired'

const operationNodeDeleteFavourite: MutationRef<
  NodeDeleteFavouriteInput,
  NodeDeleteFavouriteOutput,
  NodeDeleteFavouriteError
> = {
  id: 'node_delete_favourite',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.unstar',
  method: 'DELETE',
  path: 'nodes/{node}/favourite',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired'],
  loadValidators: async () => (await import('./validators')).operationNodeDeleteFavourite,
}

export type NodeGrantsOutputExplainRowShape = {
  node: string
  depth: number
  principal: string
  role: number
  expires_on: string | null
  pass: number
  held: boolean
  winner: boolean
}

export type NodeGrantsOutputExplainShape = {
  role: number
  source: string
  rows: Array<NodeGrantsOutputExplainRowShape>
}

export type NodeGrantsOutputGrantShape = {
  name: string
  node: string
  principal: string
  role: number
  person?: NodeGrantsOutputPerson
  expires_on: string | null
  has_password: boolean
  sent_to: string | null
  url?: string
}

export type NodeGrantsOutputInheritedGrantShape = {
  grant: NodeGrantsOutputGrantShape | NodeGrantsOutputRedactedGrantShape
  redacted: boolean
  source_node: string
  source_title: string
}

export type NodeGrantsOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodeGrantsOutputRedactedGrantShape = {
  node: string
  principal: '$LINK'
  role: number
  expires_on: string | null
  has_password: boolean
}

export type NodeGrantsInput = { inherited?: boolean; principal?: string; node: string }

export type NodeGrantsOutput = {
  grants: Array<NodeGrantsOutputGrantShape>
  owner: NodeGrantsOutputPerson | null
  inherited?: Array<NodeGrantsOutputInheritedGrantShape>
  explain?: NodeGrantsOutputExplainShape
}

export type NodeGrantsError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden'

const operationNodeGrants: QueryRef<NodeGrantsInput, NodeGrantsOutput, NodeGrantsError> = {
  id: 'node_grants',
  owner: 'drive',
  kind: 'query',
  publicName: 'grants.list',
  method: 'GET',
  path: 'nodes/{node}/grants',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationNodeGrants,
}

export type NodePutGrantOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodePutGrantInput = {
  role: number
  expires_on?: string | null
  password?: string | null
  send_to?: string
  notify?: boolean
  node: string
  principal: string
}

export type NodePutGrantOutput = {
  name: string
  node: string
  principal: string
  role: number
  person?: NodePutGrantOutputPerson
  expires_on: string | null
  has_password: boolean
  sent_to: string | null
  url?: string
}

export type NodePutGrantError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden'

const operationNodePutGrant: MutationRef<NodePutGrantInput, NodePutGrantOutput, NodePutGrantError> =
  {
    id: 'node_put_grant',
    owner: 'drive',
    kind: 'mutation',
    publicName: 'grants.put',
    method: 'PUT',
    path: 'nodes/{node}/grants/{principal:path}',
    prefix: '/api/suite/drive/',
    pathParams: ['node', 'principal'],
    nodeParams: ['node'],
    entity: null,
    errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden'],
    loadValidators: async () => (await import('./validators')).operationNodePutGrant,
  }

export type NodeDeleteGrantInput = { below?: boolean; node: string; principal: string }

export type NodeDeleteGrantOutput = { count: number }

export type NodeDeleteGrantError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden'

const operationNodeDeleteGrant: MutationRef<
  NodeDeleteGrantInput,
  NodeDeleteGrantOutput,
  NodeDeleteGrantError
> = {
  id: 'node_delete_grant',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'grants.remove',
  method: 'DELETE',
  path: 'nodes/{node}/grants/{principal:path}',
  prefix: '/api/suite/drive/',
  pathParams: ['node', 'principal'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationNodeDeleteGrant,
}

export type GrantPatchOutputPerson = { id: string; full_name: string; user_image: string | null }

export type GrantPatchInput = {
  role: number
  expires_on?: string | null
  password?: string | null
  grant: string
}

export type GrantPatchOutput = {
  name: string
  node: string
  principal: string
  role: number
  person?: GrantPatchOutputPerson
  expires_on: string | null
  has_password: boolean
  sent_to: string | null
  url?: string
}

export type GrantPatchError = 'DriveNotFound' | 'DriveForbidden'

const operationGrantPatch: MutationRef<GrantPatchInput, GrantPatchOutput, GrantPatchError> = {
  id: 'grant_patch',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'grants.update',
  method: 'PATCH',
  path: 'grants/{grant}',
  prefix: '/api/suite/drive/',
  pathParams: ['grant'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationGrantPatch,
}

export type GrantDeleteInput = { grant: string }

export type GrantDeleteOutput = { count: number }

export type GrantDeleteError = 'DriveNotFound' | 'DriveForbidden'

const operationGrantDelete: MutationRef<GrantDeleteInput, GrantDeleteOutput, GrantDeleteError> = {
  id: 'grant_delete',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'grants.delete',
  method: 'DELETE',
  path: 'grants/{grant}',
  prefix: '/api/suite/drive/',
  pathParams: ['grant'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationGrantDelete,
}

export type GrantRotateOutputPerson = { id: string; full_name: string; user_image: string | null }

export type GrantRotateInput = { grant: string }

export type GrantRotateOutput = {
  name: string
  node: string
  principal: string
  role: number
  person?: GrantRotateOutputPerson
  expires_on: string | null
  has_password: boolean
  sent_to: string | null
  url?: string
}

export type GrantRotateError = 'DriveNotFound' | 'DriveForbidden'

const operationGrantRotate: MutationRef<GrantRotateInput, GrantRotateOutput, GrantRotateError> = {
  id: 'grant_rotate',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'grants.rotate',
  method: 'POST',
  path: 'grants/{grant}/rotate',
  prefix: '/api/suite/drive/',
  pathParams: ['grant'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationGrantRotate,
}

export type LinkUnlockInput = { token: string; password: string }

export type LinkUnlockOutput = { ticket: string; expires: number }

export type LinkUnlockError =
  'DriveNotFound' | 'DriveForbidden' | 'DriveLocked' | 'DriveLinkExpired' | 'RateLimitExceededError'

const operationLinkUnlock: MutationRef<LinkUnlockInput, LinkUnlockOutput, LinkUnlockError> = {
  id: 'link_unlock',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'links.unlock',
  method: 'POST',
  path: 'links/unlock',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'RateLimitExceededError',
  ],
  loadValidators: async () => (await import('./validators')).operationLinkUnlock,
}

export type ViewClearRecentsInput = { nodes?: Array<string> }

export type ViewClearRecentsOutput = { count: number }

export type ViewClearRecentsError = never

const operationViewClearRecents: MutationRef<
  ViewClearRecentsInput,
  ViewClearRecentsOutput,
  ViewClearRecentsError
> = {
  id: 'view_clear_recents',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'views.clearRecent',
  method: 'DELETE',
  path: 'views/recents',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationViewClearRecents,
}

export type ViewListOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export type ViewListOutputArchivedRootShape = {
  root: string
  user: string | null
  used_bytes: number
  quota_bytes: number
}

export type ViewListOutputBreadcrumbShape = { name: string; title: string; kind: string }

export type ViewListOutputNodeShape = {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: ViewListOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: ViewListOutputAccessShape
  breadcrumbs?: Array<ViewListOutputBreadcrumbShape>
  preview?: ViewListOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
}

export type ViewListOutputPerson = { id: string; full_name: string; user_image: string | null }

export type ViewListOutputPreviewShape = { url: string; expires: number }

export type ViewListInput = {
  limit?: number
  cursor?: string
  root?: string
  content_doctype?: string
  term?: string
  type?: string
  expand?: string
  view: string
}

export type ViewListOutput = {
  rows: Array<ViewListOutputNodeShape | ViewListOutputArchivedRootShape>
  next_cursor: string | null
}

export type ViewListError = 'DriveNotFound' | 'DriveForbidden'

const operationViewList: PageRef<
  ViewListInput,
  ViewListOutputNodeShape | ViewListOutputArchivedRootShape,
  ViewListError,
  ViewListOutput
> = {
  id: 'view_list',
  owner: 'drive',
  kind: 'query',
  publicName: 'views.list',
  page: { cursor: 'cursor', rows: 'rows', next: 'next_cursor' },
  method: 'GET',
  path: 'views/{view}',
  prefix: '/api/suite/drive/',
  pathParams: ['view'],
  nodeParams: [],
  entity: { tag: 'DriveNode', id: 'name', version: 'modified' },
  errors: ['DriveNotFound', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationViewList,
}

export type NodeVersionsOutputVersionShape = {
  name: string
  node: string
  seq: number
  kind: string
  label: string | null
  pinned: number
  actor: string
  size: number
  creation: string | null
}

export type NodeVersionsInput = { limit?: number; cursor?: string; node: string }

export type NodeVersionsOutput = {
  rows: Array<NodeVersionsOutputVersionShape>
  next_cursor: string | null
}

export type NodeVersionsError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeVersions: PageRef<
  NodeVersionsInput,
  NodeVersionsOutputVersionShape,
  NodeVersionsError,
  NodeVersionsOutput
> = {
  id: 'node_versions',
  owner: 'drive',
  kind: 'query',
  publicName: 'versions.list',
  page: { cursor: 'cursor', rows: 'rows', next: 'next_cursor' },
  method: 'GET',
  path: 'nodes/{node}/versions',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVersions,
}

export type NodeVersionCreateInput = {
  kind?: 'auto' | 'named' | 'milestone'
  label?: string
  node: string
}

export type NodeVersionCreateOutput = {
  name: string
  node: string
  seq: number
  kind: string
  label: string | null
  pinned: number
  actor: string
  size: number
  creation: string | null
}

export type NodeVersionCreateError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeVersionCreate: MutationRef<
  NodeVersionCreateInput,
  NodeVersionCreateOutput,
  NodeVersionCreateError
> = {
  id: 'node_version_create',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'versions.create',
  method: 'POST',
  path: 'nodes/{node}/versions',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVersionCreate,
}

export type NodeVersionPatchInput = { label?: string; pinned?: boolean; node: string; seq: string }

export type NodeVersionPatchOutput = {
  name: string
  node: string
  seq: number
  kind: string
  label: string | null
  pinned: number
  actor: string
  size: number
  creation: string | null
}

export type NodeVersionPatchError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeVersionPatch: MutationRef<
  NodeVersionPatchInput,
  NodeVersionPatchOutput,
  NodeVersionPatchError
> = {
  id: 'node_version_patch',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'versions.update',
  method: 'PATCH',
  path: 'nodes/{node}/versions/{seq}',
  prefix: '/api/suite/drive/',
  pathParams: ['node', 'seq'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVersionPatch,
}

export type NodeVersionDeleteInput = { node: string; seq: string }

export type NodeVersionDeleteOutput = { count: number }

export type NodeVersionDeleteError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeVersionDelete: MutationRef<
  NodeVersionDeleteInput,
  NodeVersionDeleteOutput,
  NodeVersionDeleteError
> = {
  id: 'node_version_delete',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'versions.delete',
  method: 'DELETE',
  path: 'nodes/{node}/versions/{seq}',
  prefix: '/api/suite/drive/',
  pathParams: ['node', 'seq'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVersionDelete,
}

export type NodeVersionContentInput = { node: string; seq: string }

export type NodeVersionContentOutput = Blob

export type NodeVersionContentError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeVersionContent: QueryRef<
  NodeVersionContentInput,
  NodeVersionContentOutput,
  NodeVersionContentError
> = {
  id: 'node_version_content',
  owner: 'drive',
  kind: 'query',
  publicName: 'versions.download',
  bytes: true,
  method: 'GET',
  path: 'nodes/{node}/versions/{seq}/content',
  prefix: '/api/suite/drive/',
  pathParams: ['node', 'seq'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVersionContent,
}

export type NodeVersionRestoreOutputVersionShape = {
  name: string
  node: string
  seq: number
  kind: string
  label: string | null
  pinned: number
  actor: string
  size: number
  creation: string | null
}

export type NodeVersionRestoreInput = { node: string; seq: string }

export type NodeVersionRestoreOutput = NodeVersionRestoreOutputVersionShape | null

export type NodeVersionRestoreError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeVersionRestore: MutationRef<
  NodeVersionRestoreInput,
  NodeVersionRestoreOutput,
  NodeVersionRestoreError
> = {
  id: 'node_version_restore',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'versions.restore',
  method: 'POST',
  path: 'nodes/{node}/versions/{seq}/restore',
  prefix: '/api/suite/drive/',
  pathParams: ['node', 'seq'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeVersionRestore,
}

export type NodeThreadsOutputCommentShape = {
  name: string
  thread: string
  node: string
  content: string
  author: string
  author_name: string | null
  person?: NodeThreadsOutputPerson
  mentions: Array<string>
  creation: string | null
  modified: string | null
}

export type NodeThreadsOutputPerson = { id: string; full_name: string; user_image: string | null }

export type NodeThreadsOutputThreadShape = {
  name: string
  node: string
  anchor: string
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  creation: string | null
  comments: Array<NodeThreadsOutputCommentShape>
}

export type NodeThreadsInput = { resolved?: boolean; node: string }

export type NodeThreadsOutput = { threads: Array<NodeThreadsOutputThreadShape> }

export type NodeThreadsError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveConflict'

const operationNodeThreads: QueryRef<NodeThreadsInput, NodeThreadsOutput, NodeThreadsError> = {
  id: 'node_threads',
  owner: 'drive',
  kind: 'query',
  publicName: 'threads.list',
  method: 'GET',
  path: 'nodes/{node}/threads',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeThreads,
}

export type NodeThreadCreateOutputCommentShape = {
  name: string
  thread: string
  node: string
  content: string
  author: string
  author_name: string | null
  person?: NodeThreadCreateOutputPerson
  mentions: Array<string>
  creation: string | null
  modified: string | null
}

export type NodeThreadCreateOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type NodeThreadCreateInput = {
  anchor: string
  text: string
  author_name?: string
  node: string
}

export type NodeThreadCreateOutput = {
  name: string
  node: string
  anchor: string
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  creation: string | null
  comments: Array<NodeThreadCreateOutputCommentShape>
}

export type NodeThreadCreateError =
  'DriveNotFound' | 'DriveLocked' | 'DriveLinkExpired' | 'DriveForbidden' | 'DriveConflict'

const operationNodeThreadCreate: MutationRef<
  NodeThreadCreateInput,
  NodeThreadCreateOutput,
  NodeThreadCreateError
> = {
  id: 'node_thread_create',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'threads.create',
  method: 'POST',
  path: 'nodes/{node}/threads',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveLocked', 'DriveLinkExpired', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodeThreadCreate,
}

export type ThreadPatchOutputCommentShape = {
  name: string
  thread: string
  node: string
  content: string
  author: string
  author_name: string | null
  person?: ThreadPatchOutputPerson
  mentions: Array<string>
  creation: string | null
  modified: string | null
}

export type ThreadPatchOutputPerson = { id: string; full_name: string; user_image: string | null }

export type ThreadPatchInput = { resolved: boolean; thread: string }

export type ThreadPatchOutput = {
  name: string
  node: string
  anchor: string
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  creation: string | null
  comments: Array<ThreadPatchOutputCommentShape>
}

export type ThreadPatchError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationThreadPatch: MutationRef<ThreadPatchInput, ThreadPatchOutput, ThreadPatchError> = {
  id: 'thread_patch',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'threads.resolve',
  method: 'PATCH',
  path: 'threads/{thread}',
  prefix: '/api/suite/drive/',
  pathParams: ['thread'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationThreadPatch,
}

export type ThreadCommentCreateOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type ThreadCommentCreateInput = { text: string; author_name?: string; thread: string }

export type ThreadCommentCreateOutput = {
  name: string
  thread: string
  node: string
  content: string
  author: string
  author_name: string | null
  person?: ThreadCommentCreateOutputPerson
  mentions: Array<string>
  creation: string | null
  modified: string | null
}

export type ThreadCommentCreateError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationThreadCommentCreate: MutationRef<
  ThreadCommentCreateInput,
  ThreadCommentCreateOutput,
  ThreadCommentCreateError
> = {
  id: 'thread_comment_create',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'comments.create',
  method: 'POST',
  path: 'threads/{thread}/comments',
  prefix: '/api/suite/drive/',
  pathParams: ['thread'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationThreadCommentCreate,
}

export type CommentPatchOutputPerson = { id: string; full_name: string; user_image: string | null }

export type CommentPatchInput = { text: string; comment: string }

export type CommentPatchOutput = {
  name: string
  thread: string
  node: string
  content: string
  author: string
  author_name: string | null
  person?: CommentPatchOutputPerson
  mentions: Array<string>
  creation: string | null
  modified: string | null
}

export type CommentPatchError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationCommentPatch: MutationRef<CommentPatchInput, CommentPatchOutput, CommentPatchError> =
  {
    id: 'comment_patch',
    owner: 'drive',
    kind: 'mutation',
    publicName: 'comments.update',
    method: 'PATCH',
    path: 'comments/{comment}',
    prefix: '/api/suite/drive/',
    pathParams: ['comment'],
    nodeParams: [],
    entity: null,
    errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
    loadValidators: async () => (await import('./validators')).operationCommentPatch,
  }

export type CommentDeleteInput = { comment: string }

export type CommentDeleteOutput = { count: number }

export type CommentDeleteError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationCommentDelete: MutationRef<
  CommentDeleteInput,
  CommentDeleteOutput,
  CommentDeleteError
> = {
  id: 'comment_delete',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'comments.delete',
  method: 'DELETE',
  path: 'comments/{comment}',
  prefix: '/api/suite/drive/',
  pathParams: ['comment'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationCommentDelete,
}

export type NotificationsListOutputActivityShape = {
  name: string
  node: string
  action: string
  actor: string
  at: string | null
  via_link: string | null
  client: string | null
  detail: { [key: string]: unknown }
}

export type NotificationsListOutputNotificationShape = {
  name: string
  read: number
  creation: string | null
  activity: NotificationsListOutputActivityShape
}

export type NotificationsListInput = { limit?: number; cursor?: string; unread?: boolean }

export type NotificationsListOutput = {
  rows: Array<NotificationsListOutputNotificationShape>
  next_cursor: string | null
}

export type NotificationsListError = never

const operationNotificationsList: PageRef<
  NotificationsListInput,
  NotificationsListOutputNotificationShape,
  NotificationsListError,
  NotificationsListOutput
> = {
  id: 'notifications_list',
  owner: 'drive',
  kind: 'query',
  publicName: 'notifications.list',
  page: { cursor: 'cursor', rows: 'rows', next: 'next_cursor' },
  method: 'GET',
  path: 'notifications',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationNotificationsList,
}

export type NotificationsUnreadCountInput = Record<string, never>

export type NotificationsUnreadCountOutput = { unread: number }

export type NotificationsUnreadCountError = never

const operationNotificationsUnreadCount: QueryRef<
  NotificationsUnreadCountInput,
  NotificationsUnreadCountOutput,
  NotificationsUnreadCountError
> = {
  id: 'notifications_unread_count',
  owner: 'drive',
  kind: 'query',
  publicName: 'notifications.unreadCount',
  method: 'GET',
  path: 'notifications/unread-count',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationNotificationsUnreadCount,
}

export type NotificationsReadNotificationNamesInput = { notifications: Array<string> }

export type NotificationsReadNotificationNamesOutput = { count: number }

export type NotificationsReadNotificationNamesError = never

const operationNotificationsReadNotificationNames: MutationRef<
  NotificationsReadNotificationNamesInput,
  NotificationsReadNotificationNamesOutput,
  NotificationsReadNotificationNamesError
> = {
  id: 'notifications_read.notification_names',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'notifications.markRead',
  method: 'POST',
  path: 'notifications/read',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () =>
    (await import('./validators')).operationNotificationsReadNotificationNames,
}

export type NotificationsReadAllNotificationsInput = { all: true }

export type NotificationsReadAllNotificationsOutput = { count: number }

export type NotificationsReadAllNotificationsError = never

const operationNotificationsReadAllNotifications: MutationRef<
  NotificationsReadAllNotificationsInput,
  NotificationsReadAllNotificationsOutput,
  NotificationsReadAllNotificationsError
> = {
  id: 'notifications_read.all_notifications',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'notifications.markAllRead',
  method: 'POST',
  path: 'notifications/read',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () =>
    (await import('./validators')).operationNotificationsReadAllNotifications,
}

export type RootsDiscoverOutputRootLocation = { node: string; title: string }

export type RootsDiscoverInput = Record<string, never>

export type RootsDiscoverOutput = {
  personal: RootsDiscoverOutputRootLocation
  organization: RootsDiscoverOutputRootLocation | null
}

export type RootsDiscoverError = never

const operationRootsDiscover: QueryRef<
  RootsDiscoverInput,
  RootsDiscoverOutput,
  RootsDiscoverError
> = {
  id: 'roots_discover',
  owner: 'drive',
  kind: 'query',
  publicName: 'roots.list',
  method: 'GET',
  path: 'roots',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationRootsDiscover,
}

export type RootUsageOutputLargestNode = {
  node: string
  title: string
  size: number
  mime: string | null
  kind: 'file' | 'document'
  type: string
}

export type RootUsageOutputTypeBytes = { type: string; bytes: number }

export type RootUsageInput = { expand?: 'breakdown'; root: string }

export type RootUsageOutput = {
  used_bytes: number
  reserved_bytes: number
  quota_bytes: number | null
  effective_quota: number
  by_type?: Array<RootUsageOutputTypeBytes>
  largest?: Array<RootUsageOutputLargestNode>
}

export type RootUsageError = 'DriveNotFound' | 'DriveForbidden'

const operationRootUsage: QueryRef<RootUsageInput, RootUsageOutput, RootUsageError> = {
  id: 'root_usage',
  owner: 'drive',
  kind: 'query',
  publicName: 'roots.usage',
  method: 'GET',
  path: 'roots/{root}/usage',
  prefix: '/api/suite/drive/',
  pathParams: ['root'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationRootUsage,
}

export type RootPatchRootQuotaInput = { quota_bytes: number; root: string }

export type RootPatchRootQuotaOutput = {
  name: string
  node: string
  kind: string
  user: string | null
  state: string
  quota_bytes: number
  used_bytes: number
  title: string
}

export type RootPatchRootQuotaError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationRootPatchRootQuota: MutationRef<
  RootPatchRootQuotaInput,
  RootPatchRootQuotaOutput,
  RootPatchRootQuotaError
> = {
  id: 'root_patch.root_quota',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'roots.setQuota',
  method: 'PATCH',
  path: 'roots/{root}',
  prefix: '/api/suite/drive/',
  pathParams: ['root'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationRootPatchRootQuota,
}

export type RootPatchRootArchiveInput = { state: 'Archived'; root: string }

export type RootPatchRootArchiveOutput = {
  name: string
  node: string
  kind: string
  user: string | null
  state: string
  quota_bytes: number
  used_bytes: number
  title: string
}

export type RootPatchRootArchiveError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationRootPatchRootArchive: MutationRef<
  RootPatchRootArchiveInput,
  RootPatchRootArchiveOutput,
  RootPatchRootArchiveError
> = {
  id: 'root_patch.root_archive',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'roots.archive',
  method: 'PATCH',
  path: 'roots/{root}',
  prefix: '/api/suite/drive/',
  pathParams: ['root'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationRootPatchRootArchive,
}

export type RootPurgeInput = { root: string }

export type RootPurgeOutput = { count: number }

export type RootPurgeError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationRootPurge: MutationRef<RootPurgeInput, RootPurgeOutput, RootPurgeError> = {
  id: 'root_purge',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'roots.purge',
  method: 'DELETE',
  path: 'roots/{root}',
  prefix: '/api/suite/drive/',
  pathParams: ['root'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationRootPurge,
}

export type RootEmptyTrashInput = { root: string }

export type RootEmptyTrashOutput = { count: number }

export type RootEmptyTrashError = 'DriveNotFound' | 'DriveForbidden' | 'DriveConflict'

const operationRootEmptyTrash: MutationRef<
  RootEmptyTrashInput,
  RootEmptyTrashOutput,
  RootEmptyTrashError
> = {
  id: 'root_empty_trash',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'roots.emptyTrash',
  method: 'POST',
  path: 'roots/{root}/trash/empty',
  prefix: '/api/suite/drive/',
  pathParams: ['root'],
  nodeParams: [],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationRootEmptyTrash,
}

export type SettingsGetInput = Record<string, never>

export type SettingsGetOutput = {
  webdav_enabled: boolean
  writer_settings: { [key: string]: unknown }
}

export type SettingsGetError = never

const operationSettingsGet: QueryRef<SettingsGetInput, SettingsGetOutput, SettingsGetError> = {
  id: 'settings_get',
  owner: 'drive',
  kind: 'query',
  publicName: 'settings.get',
  method: 'GET',
  path: 'settings',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSettingsGet,
}

export type SettingsPatchInput = { webdav_enabled: boolean }

export type SettingsPatchOutput = {
  webdav_enabled: boolean
  writer_settings: { [key: string]: unknown }
}

export type SettingsPatchError = never

const operationSettingsPatch: MutationRef<
  SettingsPatchInput,
  SettingsPatchOutput,
  SettingsPatchError
> = {
  id: 'settings_patch',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'settings.update',
  method: 'PATCH',
  path: 'settings',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSettingsPatch,
}

export type SiteSettingsGetOutputAdminSiteSettings = {
  is_admin: boolean
  preview_size: number
  webdav_enabled: boolean
  webdav_allowed_methods: string
  default_personal_quota: number
  shared_quota: number
}

export type SiteSettingsGetOutputSiteSettings = { is_admin: boolean; preview_size: number }

export type SiteSettingsGetInput = Record<string, never>

export type SiteSettingsGetOutput =
  SiteSettingsGetOutputSiteSettings | SiteSettingsGetOutputAdminSiteSettings

export type SiteSettingsGetError = never

const operationSiteSettingsGet: QueryRef<
  SiteSettingsGetInput,
  SiteSettingsGetOutput,
  SiteSettingsGetError
> = {
  id: 'site_settings_get',
  owner: 'drive',
  kind: 'query',
  publicName: 'siteSettings.get',
  method: 'GET',
  path: 'site-settings',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSiteSettingsGet,
}

export type SiteSettingsPatchInput = { webdav_enabled: boolean }

export type SiteSettingsPatchOutput = {
  is_admin: boolean
  preview_size: number
  webdav_enabled: boolean
  webdav_allowed_methods: string
  default_personal_quota: number
  shared_quota: number
}

export type SiteSettingsPatchError = 'DriveForbidden'

const operationSiteSettingsPatch: MutationRef<
  SiteSettingsPatchInput,
  SiteSettingsPatchOutput,
  SiteSettingsPatchError
> = {
  id: 'site_settings_patch',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'siteSettings.update',
  method: 'PATCH',
  path: 'site-settings',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationSiteSettingsPatch,
}

export type WebdavGetOutputWebdavConnection = {
  globally_enabled: boolean
  is_admin: boolean
  server_url: string
  username: string
  enabled_for_user: boolean
  two_factor_blocked: boolean
  api_key: string | null
}

export type WebdavGetOutputWebdavHidden = Record<string, never>

export type WebdavGetOutputWebdavOff = { globally_enabled: boolean; is_admin: boolean }

export type WebdavGetInput = Record<string, never>

export type WebdavGetOutput =
  WebdavGetOutputWebdavHidden | WebdavGetOutputWebdavOff | WebdavGetOutputWebdavConnection

export type WebdavGetError = never

const operationWebdavGet: QueryRef<WebdavGetInput, WebdavGetOutput, WebdavGetError> = {
  id: 'webdav_get',
  owner: 'drive',
  kind: 'query',
  publicName: 'webdav.get',
  method: 'GET',
  path: 'webdav',
  prefix: '/api/suite/drive/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationWebdavGet,
}

export const api = {
  nodes: {
    createFolder: operationNodeCreateCreateFolder,
    createFile: operationNodeCreateCreateFile,
    createLink: operationNodeCreateCreateLink,
    createDocument: operationNodeCreateCreateDocument,
    batch: operationNodeBatch,
    purgeBatch: operationNodeBatchPurge,
    get: operationNodeGet,
    rename: operationNodePatchRename,
    move: operationNodePatchMove,
    trash: operationNodePatchTrash,
    restore: operationNodePatchRestore,
    stamp: operationNodePatchStamp,
    purge: operationNodePurge,
    children: operationNodeChildren,
    copy: operationNodeCopy,
    replaceContent: operationNodePutContent,
    download: operationNodeGetContent,
    media: operationNodeMedia,
    setPreview: operationNodePreview,
    activity: operationNodeActivity,
    visit: operationNodeVisit,
    star: operationNodePutFavourite,
    unstar: operationNodeDeleteFavourite,
  },
  archives: {
    start: operationNodeArchiveStart,
    get: operationNodeArchiveStatus,
    download: operationNodeArchiveDownload,
  },
  uploads: {
    create: operationUploadCreate,
    chunk: operationUploadChunk,
    finish: operationUploadFinish,
  },
  grants: {
    list: operationNodeGrants,
    put: operationNodePutGrant,
    remove: operationNodeDeleteGrant,
    update: operationGrantPatch,
    delete: operationGrantDelete,
    rotate: operationGrantRotate,
  },
  links: {
    unlock: operationLinkUnlock,
  },
  views: {
    clearRecent: operationViewClearRecents,
    list: operationViewList,
  },
  versions: {
    list: operationNodeVersions,
    create: operationNodeVersionCreate,
    update: operationNodeVersionPatch,
    delete: operationNodeVersionDelete,
    download: operationNodeVersionContent,
    restore: operationNodeVersionRestore,
  },
  threads: {
    list: operationNodeThreads,
    create: operationNodeThreadCreate,
    resolve: operationThreadPatch,
  },
  comments: {
    create: operationThreadCommentCreate,
    update: operationCommentPatch,
    delete: operationCommentDelete,
  },
  notifications: {
    list: operationNotificationsList,
    unreadCount: operationNotificationsUnreadCount,
    markRead: operationNotificationsReadNotificationNames,
    markAllRead: operationNotificationsReadAllNotifications,
  },
  roots: {
    list: operationRootsDiscover,
    usage: operationRootUsage,
    setQuota: operationRootPatchRootQuota,
    archive: operationRootPatchRootArchive,
    purge: operationRootPurge,
    emptyTrash: operationRootEmptyTrash,
  },
  settings: {
    get: operationSettingsGet,
    update: operationSettingsPatch,
  },
  siteSettings: {
    get: operationSiteSettingsGet,
    update: operationSiteSettingsPatch,
  },
  webdav: {
    get: operationWebdavGet,
  },
} as const
