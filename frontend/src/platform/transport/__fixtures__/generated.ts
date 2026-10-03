// Generated from src/platform/transport/__fixtures__/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type NodeGetInput = { "expand"?: Array<string>; "node": string }

export type NodeGetOutput = { "name": string; "title": string; "modified"?: string | null }

export type NodeGetError = "DriveNotFound" | "DriveForbidden"

const operationNodeGet: Operation<NodeGetInput, NodeGetOutput, NodeGetError> = {
  id: "node_get",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"Drive Node","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveForbidden"],
  validateInput(value): asserts value is NodeGetInput { assertSchema(value, {"type":"object","properties":{"expand":{"type":"array","items":{"type":"string"}},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_get input') },
  validateOutput(value): asserts value is NodeGetOutput { assertSchema(value, {"type":"object","properties":{"name":{"type":"string"},"title":{"type":"string"},"modified":{"type":["string","null"]}},"required":["name","title"]}, 'node_get output') },
}

export type NodePatchRenameInput = { "title": string; "node": string }

export type NodePatchRenameOutput = { "name": string; "title": string; "modified"?: string | null }

export type NodePatchRenameError = "DriveForbidden" | "DriveConflict"

const operationNodePatchRename: Operation<NodePatchRenameInput, NodePatchRenameOutput, NodePatchRenameError> = {
  id: "node_patch.rename",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"Drive Node","id":"name","version":"modified"},
  errors: ["DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodePatchRenameInput { assertSchema(value, {"type":"object","properties":{"title":{"type":"string"},"node":{"type":"string"}},"required":["title","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.rename input') },
  validateOutput(value): asserts value is NodePatchRenameOutput { assertSchema(value, {"type":"object","properties":{"name":{"type":"string"},"title":{"type":"string"},"modified":{"type":["string","null"]}},"required":["name","title"]}, 'node_patch.rename output') },
}

export const api = {
  "node_get": operationNodeGet,
  "node_patch": {
    "rename": operationNodePatchRename
  }
} as const

function assertSchema(value: unknown, schema: any, label: string, root: any = schema): void {
  if (!schema || Object.keys(schema).length === 0) return
  if (schema.$ref) return assertSchema(value, resolveRef(root, schema.$ref), label, root)
  if (schema.const !== undefined && value !== schema.const) throw new TypeError(label + ' must equal ' + JSON.stringify(schema.const))
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new TypeError(label + ' is not an allowed value')
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((part: any) => valid(value, part, root))) throw new TypeError(label + ' does not match any allowed shape')
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((part: any) => valid(value, part, root)).length !== 1) throw new TypeError(label + ' must match exactly one shape')
  if (Array.isArray(schema.allOf)) for (const part of schema.allOf) assertSchema(value, part, label, root)
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type: string) => matchesType(value, type))) throw new TypeError(label + ' has the wrong type')
  if ((types.includes('object') || schema.properties) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (record[key] === undefined) throw new TypeError(label + '.' + key + ' is required')
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (schema.properties ?? {}))) throw new TypeError(label + '.' + key + ' is not allowed')
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (record[key] !== undefined) assertSchema(record[key], child, label + '.' + key, root)
  }
  if ((types.includes('array') || schema.items) && Array.isArray(value)) value.forEach((item, index) => assertSchema(item, schema.items ?? {}, label + '[' + index + ']', root))
}

function valid(value: unknown, schema: any, root: any): boolean {
  try { assertSchema(value, schema, 'value', root); return true } catch { return false }
}

function resolveRef(root: any, ref: string): any {
  if (!ref.startsWith('#/')) throw new TypeError('Only local JSON schema references are supported')
  return ref.slice(2).split('/').reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root)
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}
