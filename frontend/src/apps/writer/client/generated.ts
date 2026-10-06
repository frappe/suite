// Generated from src/apps/writer/client/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type CollabGetInput = { "node": string }

export type CollabGetOutput = Blob

export type CollabGetError = "DriveNotFound" | "DriveForbidden" | "DriveLocked"

const operationCollabGet: Operation<CollabGetInput, CollabGetOutput, CollabGetError> = {
  id: "collab_get",
  owner: "writer",
  method: "GET",
  path: "documents/{node}/collab",
  prefix: "/api/suite/writer/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveLocked"],
  validateInput(value): asserts value is CollabGetInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'collab_get input') },
  validateOutput(value): asserts value is CollabGetOutput { void value },
}

export type CollabUpdatesGetInput = { "node": string }

export type CollabUpdatesGetOutput = Blob

export type CollabUpdatesGetError = "DriveNotFound" | "DriveForbidden" | "DriveLocked"

const operationCollabUpdatesGet: Operation<CollabUpdatesGetInput, CollabUpdatesGetOutput, CollabUpdatesGetError> = {
  id: "collab_updates_get",
  owner: "writer",
  method: "GET",
  path: "documents/{node}/collab/updates",
  prefix: "/api/suite/writer/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveLocked"],
  validateInput(value): asserts value is CollabUpdatesGetInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'collab_updates_get input') },
  validateOutput(value): asserts value is CollabUpdatesGetOutput { void value },
}

export type CollabUpdatesPostInput = { "node": string; "chunk": unknown } & { chunk: Blob }

export type CollabUpdatesPostOutput = { [key: string]: (number) | (string) }

export type CollabUpdatesPostError = "DriveNotFound" | "DriveForbidden" | "DriveLocked"

const operationCollabUpdatesPost: Operation<CollabUpdatesPostInput, CollabUpdatesPostOutput, CollabUpdatesPostError> = {
  id: "collab_updates_post",
  owner: "writer",
  method: "POST",
  path: "documents/{node}/collab/updates",
  prefix: "/api/suite/writer/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveLocked"],
  body: 'chunk',
  validateInput(value): asserts value is CollabUpdatesPostInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"chunk":{}},"required":["node","chunk"],"additionalProperties":false,"$defs":{}}, 'collab_updates_post input') },
  validateOutput(value): asserts value is CollabUpdatesPostOutput { assertSchema(value, {"additionalProperties":{"anyOf":[{"type":"integer"},{"type":"string"}]},"type":"object"}, 'collab_updates_post output') },
}

export type CollabSessionsPostInput = { "node": string; "chunk": unknown } & { chunk: Blob }

export type CollabSessionsPostOutput = { [key: string]: (number) | (string) }

export type CollabSessionsPostError = "DriveNotFound" | "DriveForbidden" | "DriveLocked"

const operationCollabSessionsPost: Operation<CollabSessionsPostInput, CollabSessionsPostOutput, CollabSessionsPostError> = {
  id: "collab_sessions_post",
  owner: "writer",
  method: "POST",
  path: "documents/{node}/collab/sessions",
  prefix: "/api/suite/writer/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveLocked"],
  body: 'chunk',
  validateInput(value): asserts value is CollabSessionsPostInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"chunk":{}},"required":["node","chunk"],"additionalProperties":false,"$defs":{}}, 'collab_sessions_post input') },
  validateOutput(value): asserts value is CollabSessionsPostOutput { assertSchema(value, {"additionalProperties":{"anyOf":[{"type":"integer"},{"type":"string"}]},"type":"object"}, 'collab_sessions_post output') },
}

export type CollabSuspectPostInput = { "node": string; "chunk": unknown } & { chunk: Blob }

export type CollabSuspectPostOutput = { [key: string]: (number) | (string) }

export type CollabSuspectPostError = "DriveNotFound" | "DriveForbidden" | "DriveLocked"

const operationCollabSuspectPost: Operation<CollabSuspectPostInput, CollabSuspectPostOutput, CollabSuspectPostError> = {
  id: "collab_suspect_post",
  owner: "writer",
  method: "POST",
  path: "documents/{node}/collab/suspect",
  prefix: "/api/suite/writer/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveLocked"],
  body: 'chunk',
  validateInput(value): asserts value is CollabSuspectPostInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"chunk":{}},"required":["node","chunk"],"additionalProperties":false,"$defs":{}}, 'collab_suspect_post input') },
  validateOutput(value): asserts value is CollabSuspectPostOutput { assertSchema(value, {"additionalProperties":{"anyOf":[{"type":"integer"},{"type":"string"}]},"type":"object"}, 'collab_suspect_post output') },
}

export const api = {
  "collab_get": operationCollabGet,
  "collab_updates_get": operationCollabUpdatesGet,
  "collab_updates_post": operationCollabUpdatesPost,
  "collab_sessions_post": operationCollabSessionsPost,
  "collab_suspect_post": operationCollabSuspectPost
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
