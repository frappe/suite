// Generated from src/apps/content/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type DocumentGetInput = { node: string }

export type DocumentGetOutput = Blob

export type DocumentGetError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationDocumentGet: QueryRef<DocumentGetInput, DocumentGetOutput, DocumentGetError> = {
  id: 'document_get',
  owner: 'content',
  kind: 'query',
  publicName: 'content.open',
  bytes: true,
  method: 'GET',
  path: '{node}/log',
  prefix: '/api/suite/content/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  loadValidators: async () => (await import('./validators')).operationDocumentGet,
}

export type UpdatesGetInput = { node: string }

export type UpdatesGetOutput = Blob

export type UpdatesGetError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationUpdatesGet: QueryRef<UpdatesGetInput, UpdatesGetOutput, UpdatesGetError> = {
  id: 'updates_get',
  owner: 'content',
  kind: 'query',
  publicName: 'content.pull',
  bytes: true,
  method: 'GET',
  path: '{node}/updates',
  prefix: '/api/suite/content/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  loadValidators: async () => (await import('./validators')).operationUpdatesGet,
}

export type UpdatesPostInput = { node: string; chunk: unknown } & { chunk: Blob }

export type UpdatesPostOutput = { [key: string]: number | string }

export type UpdatesPostError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationUpdatesPost: MutationRef<UpdatesPostInput, UpdatesPostOutput, UpdatesPostError> = {
  id: 'updates_post',
  owner: 'content',
  kind: 'mutation',
  publicName: 'content.push',
  method: 'POST',
  path: '{node}/updates',
  prefix: '/api/suite/content/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationUpdatesPost,
}

export type StagePutInput = { node: string; stage_id: string; idx: string; chunk: unknown } & {
  chunk: Blob
}

export type StagePutOutput = { [key: string]: number | string }

export type StagePutError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationStagePut: MutationRef<StagePutInput, StagePutOutput, StagePutError> = {
  id: 'stage_put',
  owner: 'content',
  kind: 'mutation',
  publicName: 'content.stage',
  method: 'PUT',
  path: '{node}/stage/{stage_id}/{idx}',
  prefix: '/api/suite/content/',
  pathParams: ['node', 'stage_id', 'idx'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationStagePut,
}

export type SessionsPostInput = { node: string; chunk: unknown } & { chunk: Blob }

export type SessionsPostOutput = { [key: string]: number | string }

export type SessionsPostError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationSessionsPost: MutationRef<SessionsPostInput, SessionsPostOutput, SessionsPostError> =
  {
    id: 'sessions_post',
    owner: 'content',
    kind: 'mutation',
    publicName: 'content.startSession',
    method: 'POST',
    path: '{node}/sessions',
    prefix: '/api/suite/content/',
    pathParams: ['node'],
    nodeParams: ['node'],
    entity: null,
    errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
    body: 'chunk',
    loadValidators: async () => (await import('./validators')).operationSessionsPost,
  }

export type SuspectPostInput = { node: string; chunk: unknown } & { chunk: Blob }

export type SuspectPostOutput = { [key: string]: number | string }

export type SuspectPostError = 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationSuspectPost: MutationRef<SuspectPostInput, SuspectPostOutput, SuspectPostError> = {
  id: 'suspect_post',
  owner: 'content',
  kind: 'mutation',
  publicName: 'content.reportSuspect',
  method: 'POST',
  path: '{node}/suspect',
  prefix: '/api/suite/content/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  body: 'chunk',
  loadValidators: async () => (await import('./validators')).operationSuspectPost,
}

export const api = {
  content: {
    open: operationDocumentGet,
    pull: operationUpdatesGet,
    push: operationUpdatesPost,
    stage: operationStagePut,
    startSession: operationSessionsPost,
    reportSuspect: operationSuspectPost,
  },
} as const
