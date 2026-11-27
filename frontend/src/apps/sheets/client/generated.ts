// Generated from src/apps/sheets/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type SpreadsheetCreateInputSheetCells = {
  name: string
  rows?: Array<Array<string | number | number | boolean | null>>
}

export type SpreadsheetCreateOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
  can_manage?: boolean
}

export type SpreadsheetCreateOutputAudienceShape = {
  kind: 'public' | 'organization' | 'link' | 'people'
  people: number
}

export type SpreadsheetCreateOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
  role: number
}

export type SpreadsheetCreateOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type SpreadsheetCreateOutputPreviewShape = { url: string; expires: number }

export type SpreadsheetCreateInput = {
  parent: string
  title: string
  sheets: Array<SpreadsheetCreateInputSheetCells>
}

export type SpreadsheetCreateOutput = {
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
  owner: SpreadsheetCreateOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: SpreadsheetCreateOutputAccessShape
  audience?: SpreadsheetCreateOutputAudienceShape
  breadcrumbs?: Array<SpreadsheetCreateOutputBreadcrumbShape>
  contents_size?: number
  preview?: SpreadsheetCreateOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
  rev: number
}

export type SpreadsheetCreateError =
  | 'DriveError'
  | 'RateLimitExceededError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'SheetsRefused'
  | 'WriteRefused'
  | 'WriteBusy'
  | 'DriveConflict'

const operationSpreadsheetCreate: MutationRef<
  SpreadsheetCreateInput,
  SpreadsheetCreateOutput,
  SpreadsheetCreateError
> = {
  id: 'spreadsheet_create',
  owner: 'sheets',
  kind: 'mutation',
  publicName: 'spreadsheets.create',
  method: 'POST',
  path: 'spreadsheets',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [
    'DriveError',
    'RateLimitExceededError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'SheetsRefused',
    'WriteRefused',
    'WriteBusy',
    'DriveConflict',
  ],
  loadValidators: async () => (await import('./validators')).operationSpreadsheetCreate,
}

export type SpreadsheetCellsWriteOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
  can_manage?: boolean
}

export type SpreadsheetCellsWriteOutputAudienceShape = {
  kind: 'public' | 'organization' | 'link' | 'people'
  people: number
}

export type SpreadsheetCellsWriteOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
  role: number
}

export type SpreadsheetCellsWriteOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type SpreadsheetCellsWriteOutputPreviewShape = { url: string; expires: number }

export type SpreadsheetCellsWriteInput = {
  sheet: string
  start: string
  rows: Array<Array<string | number | number | boolean | null>>
  node: string
}

export type SpreadsheetCellsWriteOutput = {
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
  owner: SpreadsheetCellsWriteOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: SpreadsheetCellsWriteOutputAccessShape
  audience?: SpreadsheetCellsWriteOutputAudienceShape
  breadcrumbs?: Array<SpreadsheetCellsWriteOutputBreadcrumbShape>
  contents_size?: number
  preview?: SpreadsheetCellsWriteOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
  rev: number
}

export type SpreadsheetCellsWriteError =
  | 'DriveError'
  | 'RateLimitExceededError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'SheetsRefused'
  | 'WriteRefused'
  | 'WriteBusy'

const operationSpreadsheetCellsWrite: MutationRef<
  SpreadsheetCellsWriteInput,
  SpreadsheetCellsWriteOutput,
  SpreadsheetCellsWriteError
> = {
  id: 'spreadsheet_cells_write',
  owner: 'sheets',
  kind: 'mutation',
  publicName: 'spreadsheets.writeCells',
  method: 'POST',
  path: 'spreadsheets/{node}/cells',
  prefix: '/api/suite/sheets/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: [
    'DriveError',
    'RateLimitExceededError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'SheetsRefused',
    'WriteRefused',
    'WriteBusy',
  ],
  loadValidators: async () => (await import('./validators')).operationSpreadsheetCellsWrite,
}

export type SpreadsheetRowsAppendOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
  can_manage?: boolean
}

export type SpreadsheetRowsAppendOutputAudienceShape = {
  kind: 'public' | 'organization' | 'link' | 'people'
  people: number
}

export type SpreadsheetRowsAppendOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
  role: number
}

export type SpreadsheetRowsAppendOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type SpreadsheetRowsAppendOutputPreviewShape = { url: string; expires: number }

export type SpreadsheetRowsAppendInput = {
  sheet: string
  rows: Array<Array<string | number | number | boolean | null>>
  node: string
}

export type SpreadsheetRowsAppendOutput = {
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
  owner: SpreadsheetRowsAppendOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: SpreadsheetRowsAppendOutputAccessShape
  audience?: SpreadsheetRowsAppendOutputAudienceShape
  breadcrumbs?: Array<SpreadsheetRowsAppendOutputBreadcrumbShape>
  contents_size?: number
  preview?: SpreadsheetRowsAppendOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
  rev: number
}

export type SpreadsheetRowsAppendError =
  | 'DriveError'
  | 'RateLimitExceededError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'SheetsRefused'
  | 'WriteRefused'
  | 'WriteBusy'

const operationSpreadsheetRowsAppend: MutationRef<
  SpreadsheetRowsAppendInput,
  SpreadsheetRowsAppendOutput,
  SpreadsheetRowsAppendError
> = {
  id: 'spreadsheet_rows_append',
  owner: 'sheets',
  kind: 'mutation',
  publicName: 'spreadsheets.appendRows',
  method: 'POST',
  path: 'spreadsheets/{node}/rows',
  prefix: '/api/suite/sheets/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: [
    'DriveError',
    'RateLimitExceededError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'SheetsRefused',
    'WriteRefused',
    'WriteBusy',
  ],
  loadValidators: async () => (await import('./validators')).operationSpreadsheetRowsAppend,
}

export type SpreadsheetSheetAddOutputAccessShape = {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
  can_manage?: boolean
}

export type SpreadsheetSheetAddOutputAudienceShape = {
  kind: 'public' | 'organization' | 'link' | 'people'
  people: number
}

export type SpreadsheetSheetAddOutputBreadcrumbShape = {
  name: string
  title: string
  kind: string
  role: number
}

export type SpreadsheetSheetAddOutputPerson = {
  id: string
  full_name: string
  user_image: string | null
}

export type SpreadsheetSheetAddOutputPreviewShape = { url: string; expires: number }

export type SpreadsheetSheetAddInput = {
  name: string
  rows?: Array<Array<string | number | number | boolean | null>>
  node: string
}

export type SpreadsheetSheetAddOutput = {
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
  owner: SpreadsheetSheetAddOutputPerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: SpreadsheetSheetAddOutputAccessShape
  audience?: SpreadsheetSheetAddOutputAudienceShape
  breadcrumbs?: Array<SpreadsheetSheetAddOutputBreadcrumbShape>
  contents_size?: number
  preview?: SpreadsheetSheetAddOutputPreviewShape | null
  opened_at?: string | null
  favourite?: boolean
  rev: number
}

export type SpreadsheetSheetAddError =
  | 'DriveError'
  | 'RateLimitExceededError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'SheetsRefused'
  | 'WriteRefused'
  | 'WriteBusy'

const operationSpreadsheetSheetAdd: MutationRef<
  SpreadsheetSheetAddInput,
  SpreadsheetSheetAddOutput,
  SpreadsheetSheetAddError
> = {
  id: 'spreadsheet_sheet_add',
  owner: 'sheets',
  kind: 'mutation',
  publicName: 'spreadsheets.addSheet',
  method: 'POST',
  path: 'spreadsheets/{node}/sheets',
  prefix: '/api/suite/sheets/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: [
    'DriveError',
    'RateLimitExceededError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'SheetsRefused',
    'WriteRefused',
    'WriteBusy',
  ],
  loadValidators: async () => (await import('./validators')).operationSpreadsheetSheetAdd,
}

export type SpreadsheetReadOutputTypedSheet = { name: string; rows: Array<Array<string>> }

export type SpreadsheetReadInput = { node: string }

export type SpreadsheetReadOutput = { sheets: Array<SpreadsheetReadOutputTypedSheet> }

export type SpreadsheetReadError =
  | 'DriveError'
  | 'RateLimitExceededError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'SheetsRefused'
  | 'WriteRefused'
  | 'WriteBusy'

const operationSpreadsheetRead: QueryRef<
  SpreadsheetReadInput,
  SpreadsheetReadOutput,
  SpreadsheetReadError
> = {
  id: 'spreadsheet_read',
  owner: 'sheets',
  kind: 'query',
  publicName: 'spreadsheets.read',
  method: 'GET',
  path: 'spreadsheets/{node}',
  prefix: '/api/suite/sheets/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: [
    'DriveError',
    'RateLimitExceededError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'SheetsRefused',
    'WriteRefused',
    'WriteBusy',
  ],
  loadValidators: async () => (await import('./validators')).operationSpreadsheetRead,
}

export type SpreadsheetValuesOutputTypedSheet = { name: string; rows: Array<Array<string>> }

export type SpreadsheetValuesInput = { node: string }

export type SpreadsheetValuesOutput = { sheets: Array<SpreadsheetValuesOutputTypedSheet> }

export type SpreadsheetValuesError =
  | 'DriveError'
  | 'RateLimitExceededError'
  | 'DriveNotFound'
  | 'DriveForbidden'
  | 'DriveLocked'
  | 'DriveLinkExpired'
  | 'SheetsRefused'
  | 'WriteRefused'
  | 'WriteBusy'

const operationSpreadsheetValues: QueryRef<
  SpreadsheetValuesInput,
  SpreadsheetValuesOutput,
  SpreadsheetValuesError
> = {
  id: 'spreadsheet_values',
  owner: 'sheets',
  kind: 'query',
  publicName: 'spreadsheets.readValues',
  method: 'GET',
  path: 'spreadsheets/{node}/values',
  prefix: '/api/suite/sheets/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: null,
  errors: [
    'DriveError',
    'RateLimitExceededError',
    'DriveNotFound',
    'DriveForbidden',
    'DriveLocked',
    'DriveLinkExpired',
    'SheetsRefused',
    'WriteRefused',
    'WriteBusy',
  ],
  loadValidators: async () => (await import('./validators')).operationSpreadsheetValues,
}

export type AgentGuideInput = Record<string, never>

export type AgentGuideOutput = Blob

export type AgentGuideError = never

const operationAgentGuide: QueryRef<AgentGuideInput, AgentGuideOutput, AgentGuideError> = {
  id: 'agent_guide',
  owner: 'sheets',
  kind: 'query',
  publicName: 'agentGuide.read',
  bytes: true,
  method: 'GET',
  path: 'agent-guide',
  prefix: '/api/suite/sheets/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationAgentGuide,
}

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
  spreadsheets: {
    create: operationSpreadsheetCreate,
    writeCells: operationSpreadsheetCellsWrite,
    appendRows: operationSpreadsheetRowsAppend,
    addSheet: operationSpreadsheetSheetAdd,
    read: operationSpreadsheetRead,
    readValues: operationSpreadsheetValues,
  },
  agentGuide: {
    read: operationAgentGuide,
  },
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
