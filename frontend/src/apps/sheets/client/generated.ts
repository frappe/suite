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

export type GetConversionInput = { name: string }

export type GetConversionOutput = {
  state: 'converted' | 'pending' | 'refused'
  outcome?: string
  reason?: string
}

export type GetConversionError = never

const operationGetConversion: QueryRef<
  GetConversionInput,
  GetConversionOutput,
  GetConversionError
> = {
  id: 'get_conversion',
  owner: 'sheets',
  kind: 'query',
  publicName: 'documents.conversion',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.sheets.api.get_conversion',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetConversion,
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

export type AiAssistInput = { name: string; prompt: string; selection: string; cells?: string }

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
    conversion: operationGetConversion,
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
