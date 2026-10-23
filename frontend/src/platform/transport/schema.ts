/** The exported contract's JSON schema subset, shared by lazy owner validators. */
export interface Schema {
  title?: string
  description?: string
  default?: unknown
  format?: string
  $ref?: string
  $defs?: Record<string, Schema>
  const?: unknown
  enum?: unknown[]
  anyOf?: Schema[]
  oneOf?: Schema[]
  allOf?: Schema[]
  type?: string | string[]
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean | Schema
  items?: Schema
  prefixItems?: Schema[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
}

export function assertSchema(value: unknown, schema: Schema, label: string, root = schema): void {
  if (schema.$ref) return assertSchema(value, resolveRef(root, schema.$ref), label, root)
  if ('const' in schema && value !== schema.const) fail(label, 'has the wrong literal value')
  if (schema.enum && !schema.enum.includes(value)) fail(label, 'is not an allowed value')
  if (schema.anyOf && !schema.anyOf.some((part) => valid(value, part, root)))
    fail(label, 'does not match an allowed shape')
  if (schema.oneOf && schema.oneOf.filter((part) => valid(value, part, root)).length !== 1)
    fail(label, 'must match exactly one shape')
  for (const part of schema.allOf ?? []) assertSchema(value, part, label, root)
  const types = typeof schema.type === 'string' ? [schema.type] : (schema.type ?? [])
  if (types.length && !types.some((type) => matchesType(value, type)))
    fail(label, 'has the wrong type')
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? [])
      if (record[key] === undefined) fail(`${label}.${key}`, 'is required')
    for (const [key, child] of Object.entries(record)) {
      const property = schema.properties?.[key]
      if (property && child !== undefined) assertSchema(child, property, `${label}.${key}`, root)
      else if (!property && schema.additionalProperties === false)
        fail(`${label}.${key}`, 'is not allowed')
      else if (!property && typeof schema.additionalProperties === 'object')
        assertSchema(child, schema.additionalProperties, `${label}.${key}`, root)
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      fail(label, 'has too few items')
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      fail(label, 'has too many items')
    schema.prefixItems?.forEach((item, index) => {
      if (index < value.length) assertSchema(value[index], item, `${label}[${index}]`, root)
    })
    if (schema.items)
      value
        .slice(schema.prefixItems?.length ?? 0)
        .forEach((item, index) =>
          assertSchema(
            item,
            schema.items!,
            `${label}[${index + (schema.prefixItems?.length ?? 0)}]`,
            root,
          ),
        )
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(label, 'is too small')
    if (schema.maximum !== undefined && value > schema.maximum) fail(label, 'is too large')
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      fail(label, 'is too short')
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      fail(label, 'is too long')
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      fail(label, 'does not match the required pattern')
  }
}

function fail(label: string, message: string): never {
  throw new TypeError(`${label} ${message}`)
}
function valid(value: unknown, schema: Schema, root: Schema): boolean {
  try {
    assertSchema(value, schema, 'value', root)
    return true
  } catch {
    return false
  }
}
function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith('#/$defs/'))
    throw new TypeError('Only local schema definitions are supported')
  const name = ref.slice('#/$defs/'.length).replaceAll('~1', '/').replaceAll('~0', '~')
  const resolved = root.$defs?.[name]
  if (!resolved) throw new TypeError(`Missing schema definition: ${name}`)
  return resolved
}
function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}
