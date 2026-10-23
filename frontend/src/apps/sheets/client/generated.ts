// Generated from src/apps/sheets/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type GetSheetInput = { name: string; compressed?: 0 | 1 }

export type GetSheetOutput = {
  name: string
  title: string
  can_write: boolean
  sheets_data: string | null
  owner: string
  node: string
}

export type GetSheetError = never

const operationGetSheet: QueryRef<GetSheetInput, GetSheetOutput, GetSheetError> = {
  id: 'get_sheet',
  owner: 'sheets',
  kind: 'query',
  publicName: 'documents.get',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.sheets.api.get_sheet',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetSheet,
}

export type SaveSheetInput = {
  name: string
  sheets_data: string
  title?: string
  ops?: string
  request_id?: string
}

export type SaveSheetOutput = { name: string; head_seq: number }

export type SaveSheetError = never

const operationSaveSheet: MutationRef<SaveSheetInput, SaveSheetOutput, SaveSheetError> = {
  id: 'save_sheet',
  owner: 'sheets',
  kind: 'mutation',
  publicName: 'documents.save',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.sheets.api.save_sheet',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSaveSheet,
}

export type OpsForCellOutputCellOperation = {
  id: string
  seq: number
  sub_sheet: string | null
  op_type: string | null
  summary: string | null
  actor: string | null
  creation: string | null
  before: unknown
  after: unknown
}

export type OpsForCellInput = { sheet: string; cell_id: string; sub_sheet?: string; limit?: number }

export type OpsForCellOutput = Array<OpsForCellOutputCellOperation>

export type OpsForCellError = never

const operationOpsForCell: QueryRef<OpsForCellInput, OpsForCellOutput, OpsForCellError> = {
  id: 'ops_for_cell',
  owner: 'sheets',
  kind: 'query',
  publicName: 'history.cell',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.sheets.versioning.api.ops_for_cell',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationOpsForCell,
}

export type GetAiSettingsInput = Record<string, never>

export type GetAiSettingsOutput = { enabled: boolean; model: string; keyIsSet: boolean }

export type GetAiSettingsError = never

const operationGetAiSettings: QueryRef<
  GetAiSettingsInput,
  GetAiSettingsOutput,
  GetAiSettingsError
> = {
  id: 'get_ai_settings',
  owner: 'sheets',
  kind: 'query',
  publicName: 'assistant.settings',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.sheets.api.get_ai_settings',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetAiSettings,
}

export type SaveAiSettingsInput = { api_key?: string; enabled?: 0 | 1; model?: string }

export type SaveAiSettingsOutput = { enabled: boolean; model: string; keyIsSet: boolean }

export type SaveAiSettingsError = never

const operationSaveAiSettings: MutationRef<
  SaveAiSettingsInput,
  SaveAiSettingsOutput,
  SaveAiSettingsError
> = {
  id: 'save_ai_settings',
  owner: 'sheets',
  kind: 'mutation',
  publicName: 'assistant.updateSettings',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.sheets.api.save_ai_settings',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSaveAiSettings,
}

export type AiAssistInput = { name: string; prompt: string; selection: string }

export type AiAssistOutput = {
  actions: Array<{ [key: string]: unknown }>
  model: string
  source: string
}

export type AiAssistError = never

const operationAiAssist: QueryRef<AiAssistInput, AiAssistOutput, AiAssistError> = {
  id: 'ai_assist',
  owner: 'sheets',
  kind: 'query',
  publicName: 'assistant.ask',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.sheets.api.ai_assist',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationAiAssist,
}

export type GetLinkPreviewOutputLinkFailure = { error: true }

export type GetLinkPreviewOutputLinkPreview = {
  title: string
  description: string
  favicon: string
  host: string
}

export type GetLinkPreviewInput = { url: string }

export type GetLinkPreviewOutput = GetLinkPreviewOutputLinkPreview | GetLinkPreviewOutputLinkFailure

export type GetLinkPreviewError = never

const operationGetLinkPreview: QueryRef<
  GetLinkPreviewInput,
  GetLinkPreviewOutput,
  GetLinkPreviewError
> = {
  id: 'get_link_preview',
  owner: 'sheets',
  kind: 'query',
  publicName: 'links.preview',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.sheets.link_preview.get_link_preview',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetLinkPreview,
}

export const api = {
  documents: {
    get: operationGetSheet,
    save: operationSaveSheet,
  },
  history: {
    cell: operationOpsForCell,
  },
  assistant: {
    settings: operationGetAiSettings,
    updateSettings: operationSaveAiSettings,
    ask: operationAiAssist,
  },
  links: {
    preview: operationGetLinkPreview,
  },
} as const
