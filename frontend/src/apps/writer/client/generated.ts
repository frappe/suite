// Generated from src/apps/writer/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type CollabGetInput = { node: string }

export type CollabGetOutput = Blob

export type CollabGetError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationCollabGet: QueryRef<CollabGetInput, CollabGetOutput, CollabGetError> = {
  id: 'collab_get',
  owner: 'writer',
  kind: 'query',
  publicName: 'collab.open',
  bytes: true,
  method: 'GET',
  path: 'documents/{node}/collab',
  prefix: '/api/suite/writer/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  loadValidators: async () => (await import('./validators')).operationCollabGet,
}

export type CollabUpdatesGetInput = { node: string }

export type CollabUpdatesGetOutput = Blob

export type CollabUpdatesGetError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationCollabUpdatesGet: QueryRef<
  CollabUpdatesGetInput,
  CollabUpdatesGetOutput,
  CollabUpdatesGetError
> = {
  id: 'collab_updates_get',
  owner: 'writer',
  kind: 'query',
  publicName: 'collab.pull',
  bytes: true,
  method: 'GET',
  path: 'documents/{node}/collab/updates',
  prefix: '/api/suite/writer/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  loadValidators: async () => (await import('./validators')).operationCollabUpdatesGet,
}

export type CollabUpdatesPostInput = { node: string; chunk: unknown } & { chunk: Blob }

export type CollabUpdatesPostOutput = { [key: string]: number | string }

export type CollabUpdatesPostError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationCollabUpdatesPost: MutationRef<
  CollabUpdatesPostInput,
  CollabUpdatesPostOutput,
  CollabUpdatesPostError
> = {
  id: 'collab_updates_post',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'collab.push',
  method: 'POST',
  path: 'documents/{node}/collab/updates',
  prefix: '/api/suite/writer/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationCollabUpdatesPost,
}

export type CollabStagePutInput = {
  node: string
  stage_id: string
  idx: string
  chunk: unknown
} & { chunk: Blob }

export type CollabStagePutOutput = { [key: string]: number | string }

export type CollabStagePutError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationCollabStagePut: MutationRef<
  CollabStagePutInput,
  CollabStagePutOutput,
  CollabStagePutError
> = {
  id: 'collab_stage_put',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'collab.stage',
  method: 'PUT',
  path: 'documents/{node}/collab/stage/{stage_id}/{idx}',
  prefix: '/api/suite/writer/',
  pathParams: ['node', 'stage_id', 'idx'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationCollabStagePut,
}

export type CollabSessionsPostInput = { node: string; chunk: unknown } & { chunk: Blob }

export type CollabSessionsPostOutput = { [key: string]: number | string }

export type CollabSessionsPostError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationCollabSessionsPost: MutationRef<
  CollabSessionsPostInput,
  CollabSessionsPostOutput,
  CollabSessionsPostError
> = {
  id: 'collab_sessions_post',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'collab.startSession',
  method: 'POST',
  path: 'documents/{node}/collab/sessions',
  prefix: '/api/suite/writer/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationCollabSessionsPost,
}

export type CollabSuspectPostInput = { node: string; chunk: unknown } & { chunk: Blob }

export type CollabSuspectPostOutput = { [key: string]: number | string }

export type CollabSuspectPostError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationCollabSuspectPost: MutationRef<
  CollabSuspectPostInput,
  CollabSuspectPostOutput,
  CollabSuspectPostError
> = {
  id: 'collab_suspect_post',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'collab.reportSuspect',
  method: 'POST',
  path: 'documents/{node}/collab/suspect',
  prefix: '/api/suite/writer/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationCollabSuspectPost,
}

export type DocumentInput = { name: string }

export type DocumentOutput = {
  name: string
  collab?: number
  content?: string | null
  html?: string | null
  ycomments?: string | null
  settings?: string | { [key: string]: unknown } | null
}

export type DocumentError = never

const operationDocument: QueryRef<DocumentInput, DocumentOutput, DocumentError> = {
  id: 'document',
  owner: 'writer',
  kind: 'query',
  publicName: 'documents.get',
  method: 'GET',
  path: '/api/v2/document/Writer Document/{name}',
  prefix: '/api/suite/writer/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationDocument,
}

export type SaveDocInput = { data: string; html?: string; name: string }

export type SaveDocOutput = null

export type SaveDocError = never

const operationSaveDoc: MutationRef<SaveDocInput, SaveDocOutput, SaveDocError> = {
  id: 'save_doc',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'documents.save',
  empty: true,
  method: 'POST',
  path: '/api/v2/document/Writer Document/{name}/method/save_doc',
  prefix: '/api/suite/writer/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSaveDoc,
}

export type SaveHtmlInput = { html: string; name: string }

export type SaveHtmlOutput = null

export type SaveHtmlError = never

const operationSaveHtml: MutationRef<SaveHtmlInput, SaveHtmlOutput, SaveHtmlError> = {
  id: 'save_html',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'documents.saveHTML',
  empty: true,
  method: 'POST',
  path: '/api/v2/document/Writer Document/{name}/method/save_html',
  prefix: '/api/suite/writer/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSaveHtml,
}

export type UpdateSettingsInput = { data: string; name: string }

export type UpdateSettingsOutput = null

export type UpdateSettingsError = never

const operationUpdateSettings: MutationRef<
  UpdateSettingsInput,
  UpdateSettingsOutput,
  UpdateSettingsError
> = {
  id: 'update_settings',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'documents.updateSettings',
  empty: true,
  method: 'POST',
  path: '/api/v2/document/Writer Document/{name}/method/update_settings',
  prefix: '/api/suite/writer/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateSettings,
}

export type SaveCommentsInput = { doc: string; data: string }

export type SaveCommentsOutput = null

export type SaveCommentsError = never

const operationSaveComments: MutationRef<SaveCommentsInput, SaveCommentsOutput, SaveCommentsError> =
  {
    id: 'save_comments',
    owner: 'writer',
    kind: 'mutation',
    publicName: 'comments.save',
    empty: true,
    method: 'POST',
    path: '/api/v2/method/suite.writer.api.docs.save_comments',
    prefix: '/api/suite/writer/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: [],
    loadValidators: async () => (await import('./validators')).operationSaveComments,
  }

export const api = {
  collab: {
    open: operationCollabGet,
    pull: operationCollabUpdatesGet,
    push: operationCollabUpdatesPost,
    stage: operationCollabStagePut,
    startSession: operationCollabSessionsPost,
    reportSuspect: operationCollabSuspectPost,
  },
  documents: {
    get: operationDocument,
    save: operationSaveDoc,
    saveHTML: operationSaveHtml,
    updateSettings: operationUpdateSettings,
  },
  comments: {
    save: operationSaveComments,
  },
} as const
