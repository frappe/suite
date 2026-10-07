// Generated from src/apps/writer/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

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
