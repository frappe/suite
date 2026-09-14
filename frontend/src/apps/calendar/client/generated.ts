// Generated from src/apps/calendar/client/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type EventsGetInput = { "from": string; "to": string; "account"?: string }

export type EventsGetOutput = Array<{ "name"?: string; "account"?: string; "id"?: string; "uid"?: string; "title"?: string; "start"?: string; "duration"?: string; "time_zone"?: string; "status"?: string; "description"?: string; "show_without_time"?: number; "recurrence_id"?: (string) | (null); "recurrence_rule"?: string; "master_id"?: string; "master_start"?: string; "master_duration"?: string; "links"?: Array<{ "uid": string; "href": (string) | (null); "content_type": (string) | (null) }>; "participants"?: Array<{  }>; "conferencing"?: ({ "meeting_id": string; "url": string }) | (null) }>

export type EventsGetError = "BadRequest" | "PermissionError"

const operationEventsGet: Operation<EventsGetInput, EventsGetOutput, EventsGetError> = {
  id: "events_get",
  owner: "calendar",
  method: "GET",
  path: "events",
  prefix: "/api/suite/calendar/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["BadRequest","PermissionError"],
  validateInput(value): asserts value is EventsGetInput { assertSchema(value, {"type":"object","properties":{"from":{"title":"From","type":"string"},"to":{"title":"To","type":"string"},"account":{"title":"Account","type":"string"}},"required":["from","to"],"additionalProperties":false,"$defs":{}}, 'events_get input') },
  validateOutput(value): asserts value is EventsGetOutput { assertSchema(value, {"$defs":{"CalendarEvent":{"properties":{"name":{"title":"Name","type":"string"},"account":{"title":"Account","type":"string"},"id":{"title":"Id","type":"string"},"uid":{"title":"Uid","type":"string"},"title":{"title":"Title","type":"string"},"start":{"title":"Start","type":"string"},"duration":{"title":"Duration","type":"string"},"time_zone":{"title":"Time Zone","type":"string"},"status":{"title":"Status","type":"string"},"description":{"title":"Description","type":"string"},"show_without_time":{"title":"Show Without Time","type":"integer"},"recurrence_id":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Recurrence Id"},"recurrence_rule":{"title":"Recurrence Rule","type":"string"},"master_id":{"title":"Master Id","type":"string"},"master_start":{"title":"Master Start","type":"string"},"master_duration":{"title":"Master Duration","type":"string"},"links":{"items":{"$ref":"#/$defs/EventLink"},"title":"Links","type":"array"},"participants":{"items":{"additionalProperties":true,"type":"object"},"title":"Participants","type":"array"},"conferencing":{"anyOf":[{"$ref":"#/$defs/Conferencing"},{"type":"null"}]}},"title":"CalendarEvent","type":"object"},"Conferencing":{"properties":{"meeting_id":{"title":"Meeting Id","type":"string"},"url":{"title":"Url","type":"string"}},"required":["meeting_id","url"],"title":"Conferencing","type":"object"},"EventLink":{"properties":{"uid":{"title":"Uid","type":"string"},"href":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Href"},"content_type":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Type"}},"required":["uid","href","content_type"],"title":"EventLink","type":"object"}},"items":{"$ref":"#/$defs/CalendarEvent"},"type":"array"}, 'events_get output') },
}

export const api = {
  "events_get": operationEventsGet
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
    for (const key of schema.required ?? []) if (!(key in record)) throw new TypeError(label + '.' + key + ' is required')
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (schema.properties ?? {}))) throw new TypeError(label + '.' + key + ' is not allowed')
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in record) assertSchema(record[key], child, label + '.' + key, root)
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
