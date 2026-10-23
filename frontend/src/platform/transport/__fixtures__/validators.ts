// Generated from src/platform/transport/__fixtures__/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  NodeGetInput,
  NodeGetOutput,
  NodePatchRenameInput,
  NodePatchRenameOutput,
} from './generated'

export const operationNodeGet: Validators<NodeGetInput, NodeGetOutput> = {
  validateInput(value: unknown): asserts value is NodeGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          expand: { type: 'array', items: { type: 'string' } },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_get input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeGetOutput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          modified: { type: ['string', 'null'] },
        },
        required: ['name', 'title'],
      },
      'node_get output',
    )
  },
}

export const operationNodePatchRename: Validators<NodePatchRenameInput, NodePatchRenameOutput> = {
  validateInput(value: unknown): asserts value is NodePatchRenameInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { title: { type: 'string' }, node: { type: 'string' } },
        required: ['title', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_patch.rename input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePatchRenameOutput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          modified: { type: ['string', 'null'] },
        },
        required: ['name', 'title'],
      },
      'node_patch.rename output',
    )
  },
}
