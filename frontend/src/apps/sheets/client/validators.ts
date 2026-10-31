// Generated from src/apps/sheets/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AiAssistInput,
  AiAssistOutput,
  GetAiSettingsInput,
  GetAiSettingsOutput,
  GetLinkPreviewInput,
  GetLinkPreviewOutput,
  GetSheetInput,
  GetSheetOutput,
  OpsForCellInput,
  OpsForCellOutput,
  SaveAiSettingsInput,
  SaveAiSettingsOutput,
  SaveSheetInput,
  SaveSheetOutput,
} from './generated'

export const operationGetSheet: Validators<GetSheetInput, GetSheetOutput> = {
  validateInput(value: unknown): asserts value is GetSheetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          compressed: { enum: [0, 1], title: 'Compressed', type: 'integer' },
        },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_sheet input',
    )
  },
  validateOutput(value: unknown): asserts value is GetSheetOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          title: { title: 'Title', type: 'string' },
          can_write: { title: 'Can Write', type: 'boolean' },
          sheets_data: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sheets Data' },
          owner: { title: 'Owner', type: 'string' },
          node: { title: 'Node', type: 'string' },
        },
        required: ['name', 'title', 'can_write', 'sheets_data', 'owner', 'node'],
        title: 'SheetBody',
        type: 'object',
      },
      'get_sheet output',
    )
  },
}

export const operationSaveSheet: Validators<SaveSheetInput, SaveSheetOutput> = {
  validateInput(value: unknown): asserts value is SaveSheetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          sheets_data: { title: 'Sheets Data', type: 'string' },
          title: { title: 'Title', type: 'string' },
          ops: { title: 'Ops', type: 'string' },
          request_id: { title: 'Request Id', type: 'string' },
        },
        required: ['name', 'sheets_data'],
        additionalProperties: false,
        $defs: {},
      },
      'save_sheet input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveSheetOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          head_seq: { title: 'Head Seq', type: 'integer' },
        },
        required: ['name', 'head_seq'],
        title: 'SavedSheet',
        type: 'object',
      },
      'save_sheet output',
    )
  },
}

export const operationOpsForCell: Validators<OpsForCellInput, OpsForCellOutput> = {
  validateInput(value: unknown): asserts value is OpsForCellInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          sheet: { title: 'Sheet', type: 'string' },
          cell_id: { title: 'Cell Id', type: 'string' },
          sub_sheet: { title: 'Sub Sheet', type: 'string' },
          limit: { title: 'Limit', type: 'integer' },
        },
        required: ['sheet', 'cell_id'],
        additionalProperties: false,
        $defs: {},
      },
      'ops_for_cell input',
    )
  },
  validateOutput(value: unknown): asserts value is OpsForCellOutput {
    assertSchema(
      value,
      {
        $defs: {
          CellOperation: {
            properties: {
              id: { title: 'Id', type: 'string' },
              seq: { title: 'Seq', type: 'integer' },
              sub_sheet: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sub Sheet' },
              op_type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Op Type' },
              summary: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Summary' },
              actor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Actor' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
              before: { title: 'Before' },
              after: { title: 'After' },
            },
            required: [
              'id',
              'seq',
              'sub_sheet',
              'op_type',
              'summary',
              'actor',
              'creation',
              'before',
              'after',
            ],
            title: 'CellOperation',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/CellOperation' },
        type: 'array',
      },
      'ops_for_cell output',
    )
  },
}

export const operationGetAiSettings: Validators<GetAiSettingsInput, GetAiSettingsOutput> = {
  validateInput(value: unknown): asserts value is GetAiSettingsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_ai_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAiSettingsOutput {
    assertSchema(
      value,
      {
        properties: {
          enabled: { title: 'Enabled', type: 'boolean' },
          model: { title: 'Model', type: 'string' },
          keyIsSet: { title: 'Keyisset', type: 'boolean' },
        },
        required: ['enabled', 'model', 'keyIsSet'],
        title: 'AISettings',
        type: 'object',
      },
      'get_ai_settings output',
    )
  },
}

export const operationSaveAiSettings: Validators<SaveAiSettingsInput, SaveAiSettingsOutput> = {
  validateInput(value: unknown): asserts value is SaveAiSettingsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          api_key: { title: 'Api Key', type: 'string' },
          enabled: { enum: [0, 1], title: 'Enabled', type: 'integer' },
          model: { title: 'Model', type: 'string' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'save_ai_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveAiSettingsOutput {
    assertSchema(
      value,
      {
        properties: {
          enabled: { title: 'Enabled', type: 'boolean' },
          model: { title: 'Model', type: 'string' },
          keyIsSet: { title: 'Keyisset', type: 'boolean' },
        },
        required: ['enabled', 'model', 'keyIsSet'],
        title: 'AISettings',
        type: 'object',
      },
      'save_ai_settings output',
    )
  },
}

export const operationAiAssist: Validators<AiAssistInput, AiAssistOutput> = {
  validateInput(value: unknown): asserts value is AiAssistInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          prompt: { title: 'Prompt', type: 'string' },
          selection: { title: 'Selection', type: 'string' },
        },
        required: ['name', 'prompt', 'selection'],
        additionalProperties: false,
        $defs: {},
      },
      'ai_assist input',
    )
  },
  validateOutput(value: unknown): asserts value is AiAssistOutput {
    assertSchema(
      value,
      {
        properties: {
          actions: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Actions',
            type: 'array',
          },
          model: { title: 'Model', type: 'string' },
          source: { title: 'Source', type: 'string' },
        },
        required: ['actions', 'model', 'source'],
        title: 'AssistResult',
        type: 'object',
      },
      'ai_assist output',
    )
  },
}

export const operationGetLinkPreview: Validators<GetLinkPreviewInput, GetLinkPreviewOutput> = {
  validateInput(value: unknown): asserts value is GetLinkPreviewInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { url: { title: 'Url', type: 'string' } },
        required: ['url'],
        additionalProperties: false,
        $defs: {},
      },
      'get_link_preview input',
    )
  },
  validateOutput(value: unknown): asserts value is GetLinkPreviewOutput {
    assertSchema(
      value,
      {
        $defs: {
          LinkFailure: {
            properties: { error: { const: true, title: 'Error', type: 'boolean' } },
            required: ['error'],
            title: 'LinkFailure',
            type: 'object',
          },
          LinkPreview: {
            properties: {
              title: { title: 'Title', type: 'string' },
              description: { title: 'Description', type: 'string' },
              favicon: { title: 'Favicon', type: 'string' },
              host: { title: 'Host', type: 'string' },
            },
            required: ['title', 'description', 'favicon', 'host'],
            title: 'LinkPreview',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/LinkPreview' }, { $ref: '#/$defs/LinkFailure' }],
      },
      'get_link_preview output',
    )
  },
}
