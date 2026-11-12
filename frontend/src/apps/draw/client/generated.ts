// Generated from src/apps/draw/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type DocumentInput = { node: string }

export type DocumentOutput = { name: string; node: string; content: string; modified: string }

export type DocumentError = 'DrawingNotFound' | 'PermissionError'

const operationDocument: QueryRef<DocumentInput, DocumentOutput, DocumentError> = {
  id: 'document',
  owner: 'draw',
  kind: 'query',
  publicName: 'documents.get',
  method: 'GET',
  path: 'documents/{node}',
  prefix: '/api/suite/draw/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: ['DrawingNotFound', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationDocument,
}

export type SaveDocumentInput = { content: string; base_modified: string; node: string }

export type SaveDocumentOutput = { name: string; node: string; content: string; modified: string }

export type SaveDocumentError =
  'DrawingNotFound' | 'DrawingConflict' | 'PermissionError' | 'ValidationError'

const operationSaveDocument: MutationRef<SaveDocumentInput, SaveDocumentOutput, SaveDocumentError> =
  {
    id: 'save_document',
    owner: 'draw',
    kind: 'mutation',
    publicName: 'documents.save',
    method: 'PUT',
    path: 'documents/{node}',
    prefix: '/api/suite/draw/',
    pathParams: ['node'],
    nodeParams: ['node'],
    entity: null,
    errors: ['DrawingNotFound', 'DrawingConflict', 'PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationSaveDocument,
  }

export const api = {
  documents: {
    get: operationDocument,
    save: operationSaveDocument,
  },
} as const
