// Generated from src/apps/content/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  DocumentGetInput,
  DocumentGetOutput,
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
          idx: { type: 'string' },
          chunk: {},
        },
        required: ['node', 'stage_id', 'idx', 'chunk'],
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
