import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(frontendRoot, 'src')

const contracts = await findContracts(sourceRoot)
for (const contractPath of contracts) {
  const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'))
  const output = generate(contract, path.relative(frontendRoot, contractPath))
  await fs.writeFile(path.join(path.dirname(contractPath), 'generated.ts'), output)
}

console.log(`Generated ${contracts.length} contract${contracts.length === 1 ? '' : 's'}.`)

async function findContracts(directory) {
  const found = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await findContracts(target)))
    else if (entry.name === 'contract.json') found.push(target)
  }
  return found.sort()
}

function generate(contract, source) {
  if (!contract || typeof contract.owner !== 'string' || !Array.isArray(contract.operations)) {
    throw new Error(`${source}: invalid contract root`)
  }
  const names = new Set()
  const declarations = []
  const leaves = []

  for (const operation of contract.operations) {
    validateOperation(operation, source)
    const name = uniqueName(pascal(operation.id), names)
    const inputSchema = combineInputSchemas(operation)
    const outputSchema = operation.output ?? {}
    const inputType = `${name}Input`
    const outputType = `${name}Output`
    const errorType = `${name}Error`
    const variable = `operation${name}`
    declarations.push(`export type ${inputType} = ${schemaType(inputSchema, inputSchema)}`)
    declarations.push(`export type ${outputType} = ${schemaType(outputSchema, outputSchema)}`)
    declarations.push(
      `export type ${errorType} = ${operation.errors?.length ? operation.errors.map(JSON.stringify).join(' | ') : 'never'}`,
    )
    declarations.push(`const ${variable}: Operation<${inputType}, ${outputType}, ${errorType}> = {
  id: ${JSON.stringify(operation.id)},
  owner: ${JSON.stringify(contract.owner)},
  method: ${JSON.stringify(operation.method)},
  path: ${JSON.stringify(operation.path)},
  prefix: ${JSON.stringify(contract.prefix ?? `/api/suite/${contract.owner}/`)},
  pathParams: ${JSON.stringify(operation.pathParams ?? [])},
  nodeParams: ${JSON.stringify(operation.nodeParams ?? [])},
  entity: ${JSON.stringify(operation.entity ?? null)},
  errors: ${JSON.stringify(operation.errors ?? [])},
  validateInput(value): asserts value is ${inputType} { assertSchema(value, ${JSON.stringify(inputSchema)}, '${operation.id} input') },
  validateOutput(value): asserts value is ${outputType} { assertSchema(value, ${JSON.stringify(outputSchema)}, '${operation.id} output') },
}`)
    leaves.push({ path: operation.id.split('.'), variable })
  }

  return `// Generated from ${source}. Do not edit.
import type { Operation } from '@/platform/transport'

${declarations.join('\n\n')}

export const api = ${renderApiTree(leaves)} as const

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
`
}

function combineInputSchemas(operation) {
  const schemas = [operation.query, operation.body].filter(Boolean)
  const properties = {}
  const required = new Set()
  let objectOnly = true
  for (const schema of schemas) {
    if (schema.type && schema.type !== 'object') objectOnly = false
    Object.assign(properties, schema.properties ?? {})
    for (const key of schema.required ?? []) required.add(key)
  }
  for (const name of operation.pathParams ?? []) {
    properties[name] ??= { type: 'string' }
    required.add(name)
  }
  if (objectOnly) {
    return {
      type: 'object',
      properties,
      required: [...required],
      additionalProperties: false,
      $defs: Object.assign({}, ...schemas.map((schema) => schema.$defs ?? {})),
    }
  }
  return { allOf: [...schemas, { type: 'object', properties, required: [...required] }] }
}

function schemaType(schema, root) {
  if (!schema || Object.keys(schema).length === 0) return 'unknown'
  if (schema.$ref) return schemaType(resolveSchemaRef(root, schema.$ref), root)
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(' | ') || 'never'
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map((part) => `(${schemaType(part, root)})`).join(' | ')
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map((part) => `(${schemaType(part, root)})`).join(' | ')
  if (Array.isArray(schema.allOf)) return schema.allOf.map((part) => `(${schemaType(part, root)})`).join(' & ')
  if (Array.isArray(schema.type)) return schema.type.map((type) => schemaType({ ...schema, type }, root)).join(' | ')
  if (schema.type === 'array') return `Array<${schemaType(schema.items ?? {}, root)}>`
  if (schema.type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? [])
    const fields = Object.entries(schema.properties ?? {}).map(
      ([key, child]) => `${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${schemaType(child, root)}`,
    )
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      fields.push(`[key: string]: ${schemaType(schema.additionalProperties, root)}`)
    }
    if (!fields.length && schema.additionalProperties === false) return 'Record<string, never>'
    return `{ ${fields.join('; ')} }`
  }
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'null') return 'null'
  return 'unknown'
}

function resolveSchemaRef(root, ref) {
  if (!ref.startsWith('#/')) return {}
  return ref.slice(2).split('/').reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root) ?? {}
}

function renderApiTree(leaves) {
  const root = {}
  for (const leaf of leaves) {
    let node = root
    for (const part of leaf.path.slice(0, -1)) node = node[part] ??= {}
    node[leaf.path.at(-1)] = leaf.variable
  }
  const render = (node, depth = 0) => {
    const pad = '  '.repeat(depth)
    const entries = Object.entries(node).map(([key, value]) => {
      const rendered = typeof value === 'string' ? value : render(value, depth + 1)
      return `${pad}  ${JSON.stringify(key)}: ${rendered}`
    })
    return `{\n${entries.join(',\n')}\n${pad}}`
  }
  return render(root)
}

function validateOperation(operation, source) {
  if (!operation || typeof operation.id !== 'string' || typeof operation.path !== 'string') {
    throw new Error(`${source}: operation is missing id or path`)
  }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method)) {
    throw new Error(`${source}: ${operation.id} has an invalid method`)
  }
}

function pascal(value) {
  const result = value.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_match, _separator, letter) => letter.toUpperCase())
  return result || 'Operation'
}

function uniqueName(name, names) {
  let next = name
  let index = 2
  while (names.has(next)) next = `${name}${index++}`
  names.add(next)
  return next
}
