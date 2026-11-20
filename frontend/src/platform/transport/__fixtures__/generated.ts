// Generated from src/platform/transport/__fixtures__/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type NodeGetInput = { expand?: Array<string>; node: string }

export type NodeGetOutput = { name: string; title: string; modified?: string | null }

export type NodeGetError = 'DriveNotFound' | 'DriveForbidden'

const operationNodeGet: QueryRef<NodeGetInput, NodeGetOutput, NodeGetError> = {
  id: 'node_get',
  owner: 'drive',
  kind: 'query',
  publicName: 'nodes.get',
  method: 'GET',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'Drive Node', id: 'name', version: 'modified' },
  errors: ['DriveNotFound', 'DriveForbidden'],
  loadValidators: async () => (await import('./validators')).operationNodeGet,
}

export type NodePatchRenameInput = { title: string; node: string }

export type NodePatchRenameOutput = { name: string; title: string; modified?: string | null }

export type NodePatchRenameError = 'DriveForbidden' | 'DriveConflict'

const operationNodePatchRename: MutationRef<
  NodePatchRenameInput,
  NodePatchRenameOutput,
  NodePatchRenameError
> = {
  id: 'node_patch.rename',
  owner: 'drive',
  kind: 'mutation',
  publicName: 'nodes.rename',
  method: 'PATCH',
  path: 'nodes/{node}',
  prefix: '/api/suite/drive/',
  pathParams: ['node'],
  nodeParams: ['node'],
  entity: { tag: 'Drive Node', id: 'name', version: 'modified' },
  errors: ['DriveForbidden', 'DriveConflict'],
  loadValidators: async () => (await import('./validators')).operationNodePatchRename,
}

export const api = {
  nodes: {
    get: operationNodeGet,
    rename: operationNodePatchRename,
  },
} as const
