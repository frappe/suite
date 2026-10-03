// Generated from src/apps/mail/client/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type InboxSummaryInput = Record<string, never>

export type InboxSummaryOutput = { "unread": number }

export type InboxSummaryError = never

const operationInboxSummary: Operation<InboxSummaryInput, InboxSummaryOutput, InboxSummaryError> = {
  id: "inbox_summary",
  owner: "mail",
  method: "GET",
  path: "inbox-summary",
  prefix: "/api/suite/mail/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is InboxSummaryInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'inbox_summary input') },
  validateOutput(value): asserts value is InboxSummaryOutput { assertSchema(value, {"properties":{"unread":{"title":"Unread","type":"integer"}},"required":["unread"],"title":"InboxSummary","type":"object"}, 'inbox_summary output') },
}

export const api = {
  "inbox_summary": operationInboxSummary
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
