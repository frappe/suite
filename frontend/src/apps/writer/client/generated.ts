// Generated from src/apps/writer/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type DocumentOutputConversionStatus = {
  state: string
  reason?: string
  rooms?: DocumentOutputRooms
}

export type DocumentOutputRooms = {
  epoch: number
  keys: Array<string>
  epoch_seconds: number
  server_time: number
}

export type DocumentInput = { name: string }

export type DocumentOutput = {
  name: string
  collab?: number
  content?: string | null
  html?: string | null
  ycomments?: string | null
  settings?: string | { [key: string]: unknown } | null
  conversion?: DocumentOutputConversionStatus
  content_modified?: string
}

export type DocumentError = 'DoesNotExistError' | 'PermissionError'

const operationDocument: QueryRef<DocumentInput, DocumentOutput, DocumentError> = {
  id: 'document',
  owner: 'writer',
  kind: 'query',
  publicName: 'documents.get',
  method: 'GET',
  path: 'documents/{name}',
  prefix: '/api/suite/writer/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: ['DoesNotExistError', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationDocument,
}

export type DocumentSettingsInput = { data: string; name: string }

export type DocumentSettingsOutput = null

export type DocumentSettingsError =
  'DoesNotExistError' | 'DriveNotFound' | 'DriveForbidden' | 'DriveLocked'

const operationDocumentSettings: MutationRef<
  DocumentSettingsInput,
  DocumentSettingsOutput,
  DocumentSettingsError
> = {
  id: 'document_settings',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'documents.updateSettings',
  empty: true,
  method: 'POST',
  path: 'documents/{name}/settings',
  prefix: '/api/suite/writer/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: ['DoesNotExistError', 'DriveNotFound', 'DriveForbidden', 'DriveLocked'],
  loadValidators: async () => (await import('./validators')).operationDocumentSettings,
}

export type DocumentCreateOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
  can_manage?: boolean
}

export type DocumentCreateOutputAudienceShape = {
  kind: 'public' | 'organization' | 'link' | 'people'
  people: number
}

export type DocumentCreateOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
  role: number
}

export type DocumentCreateOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type DocumentCreateOutputPreviewShape = { url: string; expires: number }

export type DocumentCreateInput = { parent: string; title: string; markdown: string }

export type DocumentCreateOutput = {
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
  owner: DocumentCreateOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: DocumentCreateOutputAccessShape
  audience?: DocumentCreateOutputAudienceShape
  breadcrumbs?: Array<DocumentCreateOutputBreadcrumbShape>
  contents_size?: number
  preview?: DocumentCreateOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
  rev: number
}

export type DocumentCreateError =
  | 'DriveError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'MarkdownRefused'
  | 'WriteRefused'
  | 'WriteBusy'
  | 'DriveConflict'

const operationDocumentCreate: MutationRef<
  DocumentCreateInput,
  DocumentCreateOutput,
  DocumentCreateError
> = {
  id: 'document_create',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'documents.create',
  method: 'POST',
  path: 'documents',
  prefix: '/api/suite/writer/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [
    'DriveError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'MarkdownRefused',
    'WriteRefused',
    'WriteBusy',
    'DriveConflict',
  ],
  loadValidators: async () => (await import('./validators')).operationDocumentCreate,
}

export type DocumentWriteOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
  can_manage?: boolean
}

export type DocumentWriteOutputAudienceShape = {
  kind: 'public' | 'organization' | 'link' | 'people'
  people: number
}

export type DocumentWriteOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
  role: number
}

export type DocumentWriteOutputPerson = { id: string; full_name: string; user_image: string | null }

export type DocumentWriteOutputPreviewShape = { url: string; expires: number }

export type DocumentWriteInput = { markdown: string; mode: 'replace' | 'append'; node: string }

export type DocumentWriteOutput = {
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
  owner: DocumentWriteOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: DocumentWriteOutputAccessShape
  audience?: DocumentWriteOutputAudienceShape
  breadcrumbs?: Array<DocumentWriteOutputBreadcrumbShape>
  contents_size?: number
  preview?: DocumentWriteOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
  rev: number
}

export type DocumentWriteError =
  | 'DriveError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'MarkdownRefused'
  | 'WriteRefused'
  | 'WriteBusy'

const operationDocumentWrite: MutationRef<
  DocumentWriteInput,
  DocumentWriteOutput,
  DocumentWriteError
> = {
  id: 'document_write',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'documents.write',
  method: 'POST',
  path: 'documents/{node}/body',
  prefix: '/api/suite/writer/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: [
    'DriveError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'MarkdownRefused',
    'WriteRefused',
    'WriteBusy',
  ],
  loadValidators: async () => (await import('./validators')).operationDocumentWrite,
}

export type AgentGuideInput = Record<string, never>

export type AgentGuideOutput = Blob

export type AgentGuideError = never

const operationAgentGuide: QueryRef<AgentGuideInput, AgentGuideOutput, AgentGuideError> = {
  id: 'agent_guide',
  owner: 'writer',
  kind: 'query',
  publicName: 'agentGuide.read',
  bytes: true,
  method: 'GET',
  path: 'agent-guide',
  prefix: '/api/suite/writer/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationAgentGuide,
}

export type OldBodyInput = { node: string }

export type OldBodyOutput = { content?: string }

export type OldBodyError = never

const operationOldBody: QueryRef<OldBodyInput, OldBodyOutput, OldBodyError> = {
  id: 'old_body',
  owner: 'writer',
  kind: 'query',
  publicName: 'documents.oldBody',
  method: 'GET',
  path: '/api/v2/method/suite.writer.api.docs.old_body',
  prefix: '/api/suite/writer/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationOldBody,
}

export type ConvertVersionInput = { node: string; seq: number }

export type ConvertVersionOutput = { state?: string; reason?: string; pending?: boolean }

export type ConvertVersionError = never

const operationConvertVersion: MutationRef<
  ConvertVersionInput,
  ConvertVersionOutput,
  ConvertVersionError
> = {
  id: 'convert_version',
  owner: 'writer',
  kind: 'mutation',
  publicName: 'versions.convert',
  method: 'POST',
  path: '/api/v2/method/suite.writer.api.docs.convert_version',
  prefix: '/api/suite/writer/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationConvertVersion,
}

export const api = {
  documents: {
    get: operationDocument,
    updateSettings: operationDocumentSettings,
    create: operationDocumentCreate,
    write: operationDocumentWrite,
    oldBody: operationOldBody,
  },
  agentGuide: {
    read: operationAgentGuide,
  },
  versions: {
    convert: operationConvertVersion,
  },
} as const
