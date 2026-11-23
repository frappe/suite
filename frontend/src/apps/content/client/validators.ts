// Generated from src/apps/content/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  DocumentGetInput,
  DocumentGetOutput,
  HtmlPostInput,
  HtmlPostOutput,
  RestoreCancelPostInput,
  RestoreCancelPostOutput,
  RestorePostInput,
  RestorePostOutput,
  SessionsPostInput,
  SessionsPostOutput,
  StagePutInput,
  StagePutOutput,
  SuspectPostInput,
  SuspectPostOutput,
  UpdatesGetInput,
  UpdatesGetOutput,
  UpdatesPostInput,
  UpdatesPostOutput,
} from './generated'

export const operationDocumentGet: Validators<DocumentGetInput, DocumentGetOutput> = {
  validateInput(value: unknown): asserts value is DocumentGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'document_get input',
    )
  },
  validateOutput(value: unknown): asserts value is DocumentGetOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationUpdatesGet: Validators<UpdatesGetInput, UpdatesGetOutput> = {
  validateInput(value: unknown): asserts value is UpdatesGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'updates_get input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdatesGetOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationUpdatesPost: Validators<UpdatesPostInput, UpdatesPostOutput> = {
  validateInput(value: unknown): asserts value is UpdatesPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'updates_post input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdatesPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'updates_post output',
    )
  },
}

export const operationStagePut: Validators<StagePutInput, StagePutOutput> = {
  validateInput(value: unknown): asserts value is StagePutInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          node: { type: 'string' },
          stage_id: { type: 'string' },
          piece_index: { type: 'string' },
          chunk: {},
        },
        required: ['node', 'stage_id', 'piece_index', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'stage_put input',
    )
  },
  validateOutput(value: unknown): asserts value is StagePutOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'stage_put output',
    )
  },
}

export const operationSessionsPost: Validators<SessionsPostInput, SessionsPostOutput> = {
  validateInput(value: unknown): asserts value is SessionsPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'sessions_post input',
    )
  },
  validateOutput(value: unknown): asserts value is SessionsPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'sessions_post output',
    )
  },
}

export const operationSuspectPost: Validators<SuspectPostInput, SuspectPostOutput> = {
  validateInput(value: unknown): asserts value is SuspectPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'suspect_post input',
    )
  },
  validateOutput(value: unknown): asserts value is SuspectPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'suspect_post output',
    )
  },
}

export const operationHtmlPost: Validators<HtmlPostInput, HtmlPostOutput> = {
  validateInput(value: unknown): asserts value is HtmlPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'html_post input',
    )
  },
  validateOutput(value: unknown): asserts value is HtmlPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'html_post output',
    )
  },
}

export const operationRestorePost: Validators<RestorePostInput, RestorePostOutput> = {
  validateInput(value: unknown): asserts value is RestorePostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'restore_post input',
    )
  },
  validateOutput(value: unknown): asserts value is RestorePostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'restore_post output',
    )
  },
}

export const operationRestoreCancelPost: Validators<
  RestoreCancelPostInput,
  RestoreCancelPostOutput
> = {
  validateInput(value: unknown): asserts value is RestoreCancelPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, chunk: {} },
        required: ['node', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'restore_cancel_post input',
    )
  },
  validateOutput(value: unknown): asserts value is RestoreCancelPostOutput {
    assertSchema(
      value,
      {
        additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        type: 'object',
      },
      'restore_cancel_post output',
    )
  },
}
