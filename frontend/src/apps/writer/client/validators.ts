// Generated from src/apps/writer/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  CollabGetInput,
  CollabGetOutput,
  CollabSessionsPostInput,
  CollabSessionsPostOutput,
  CollabStagePutInput,
  CollabStagePutOutput,
  CollabSuspectPostInput,
  CollabSuspectPostOutput,
  CollabUpdatesGetInput,
  CollabUpdatesGetOutput,
  CollabUpdatesPostInput,
  CollabUpdatesPostOutput,
  DocumentInput,
  DocumentOutput,
  SaveCommentsInput,
  SaveCommentsOutput,
  SaveDocInput,
  SaveDocOutput,
  SaveHtmlInput,
  SaveHtmlOutput,
  UpdateSettingsInput,
  UpdateSettingsOutput,
} from './generated'

export const operationCollabGet: Validators<CollabGetInput, CollabGetOutput> = {
  validateInput(value: unknown): asserts value is CollabGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'collab_get input',
    )
  },
  validateOutput(value: unknown): asserts value is CollabGetOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationCollabUpdatesGet: Validators<CollabUpdatesGetInput, CollabUpdatesGetOutput> =
  {
    validateInput(value: unknown): asserts value is CollabUpdatesGetInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { node: { type: 'string' } },
          required: ['node'],
          additionalProperties: false,
          $defs: {},
        },
        'collab_updates_get input',
      )
    },
    validateOutput(value: unknown): asserts value is CollabUpdatesGetOutput {
      if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
    },
  }

export const operationCollabUpdatesPost: Validators<
  CollabUpdatesPostInput,
  CollabUpdatesPostOutput
> = {
  validateInput(value: unknown): asserts value is CollabUpdatesPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'collab_updates_post input',
    )
  },
  validateOutput(value: unknown): asserts value is CollabUpdatesPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'collab_updates_post output',
    )
  },
}

export const operationCollabStagePut: Validators<CollabStagePutInput, CollabStagePutOutput> = {
  validateInput(value: unknown): asserts value is CollabStagePutInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          node: { type: 'string' },
          stage_id: { type: 'string' },
          idx: { type: 'string' },
          chunk: {},
        },
        required: ['node', 'stage_id', 'idx', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'collab_stage_put input',
    )
  },
  validateOutput(value: unknown): asserts value is CollabStagePutOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'collab_stage_put output',
    )
  },
}

export const operationCollabSessionsPost: Validators<
  CollabSessionsPostInput,
  CollabSessionsPostOutput
> = {
  validateInput(value: unknown): asserts value is CollabSessionsPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'collab_sessions_post input',
    )
  },
  validateOutput(value: unknown): asserts value is CollabSessionsPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'collab_sessions_post output',
    )
  },
}

export const operationCollabSuspectPost: Validators<
  CollabSuspectPostInput,
  CollabSuspectPostOutput
> = {
  validateInput(value: unknown): asserts value is CollabSuspectPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'collab_suspect_post input',
    )
  },
  validateOutput(value: unknown): asserts value is CollabSuspectPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'collab_suspect_post output',
    )
  },
}

export const operationDocument: Validators<DocumentInput, DocumentOutput> = {
  validateInput(value: unknown): asserts value is DocumentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'document input',
    )
  },
  validateOutput(value: unknown): asserts value is DocumentOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          collab: { title: 'Collab', type: 'integer' },
          content: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Content' },
          html: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html' },
          ycomments: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Ycomments' },
          settings: {
            anyOf: [
              { type: 'string' },
              { additionalProperties: true, type: 'object' },
              { type: 'null' },
            ],
            title: 'Settings',
          },
        },
        required: ['name'],
        title: 'WriterRow',
        type: 'object',
      },
      'document output',
    )
  },
}

export const operationSaveDoc: Validators<SaveDocInput, SaveDocOutput> = {
  validateInput(value: unknown): asserts value is SaveDocInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          data: { title: 'Data', type: 'string' },
          html: { title: 'Html', type: 'string' },
          name: { type: 'string' },
        },
        required: ['data', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'save_doc input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveDocOutput {
    assertSchema(value, { type: 'null' }, 'save_doc output')
  },
}

export const operationSaveHtml: Validators<SaveHtmlInput, SaveHtmlOutput> = {
  validateInput(value: unknown): asserts value is SaveHtmlInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { html: { title: 'Html', type: 'string' }, name: { type: 'string' } },
        required: ['html', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'save_html input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveHtmlOutput {
    assertSchema(value, { type: 'null' }, 'save_html output')
  },
}

export const operationUpdateSettings: Validators<UpdateSettingsInput, UpdateSettingsOutput> = {
  validateInput(value: unknown): asserts value is UpdateSettingsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { data: { title: 'Data', type: 'string' }, name: { type: 'string' } },
        required: ['data', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'update_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateSettingsOutput {
    assertSchema(value, { type: 'null' }, 'update_settings output')
  },
}

export const operationSaveComments: Validators<SaveCommentsInput, SaveCommentsOutput> = {
  validateInput(value: unknown): asserts value is SaveCommentsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          doc: { title: 'Doc', type: 'string' },
          data: { title: 'Data', type: 'string' },
        },
        required: ['doc', 'data'],
        additionalProperties: false,
        $defs: {},
      },
      'save_comments input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveCommentsOutput {
    assertSchema(value, { type: 'null' }, 'save_comments output')
  },
}
