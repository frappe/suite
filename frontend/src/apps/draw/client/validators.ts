// Generated from src/apps/draw/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  DocumentInput,
  DocumentOutput,
  SaveDocumentInput,
  SaveDocumentOutput,
} from './generated'

export const operationDocument: Validators<DocumentInput, DocumentOutput> = {
  validateInput(value: unknown): asserts value is DocumentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
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
          node: { title: 'Node', type: 'string' },
          content: { title: 'Content', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
        },
        required: ['name', 'node', 'content', 'modified'],
        title: 'DrawingBody',
        type: 'object',
      },
      'document output',
    )
  },
}

export const operationSaveDocument: Validators<SaveDocumentInput, SaveDocumentOutput> = {
  validateInput(value: unknown): asserts value is SaveDocumentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          content: { title: 'Content', type: 'string' },
          base_modified: { title: 'Base Modified', type: 'string' },
          node: { type: 'string' },
        },
        required: ['content', 'base_modified', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'save_document input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveDocumentOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          content: { title: 'Content', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
        },
        required: ['name', 'node', 'content', 'modified'],
        title: 'DrawingBody',
        type: 'object',
      },
      'save_document output',
    )
  },
}
