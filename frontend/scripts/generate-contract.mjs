import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(frontendRoot, 'src')

const schemaNames = new WeakMap()

const checking = process.argv.includes('--check')
const contracts = await findContracts(sourceRoot)
for (const contractPath of contracts) {
  const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'))
  const { output, validators } = generate(contract, path.relative(frontendRoot, contractPath))
  for (const [name, source] of [
    ['generated.ts', output],
    ['validators.ts', validators],
  ]) {
    const target = path.join(path.dirname(contractPath), name)
    const formatted = await format(source, { ...(await resolveConfig(target)), filepath: target })
    if (checking) {
      if ((await fs.readFile(target, 'utf8').catch(() => '')) !== formatted)
        throw new Error(`${target}: contract drift; run yarn generate:contract`)
    } else await fs.writeFile(target, formatted)
  }
}
console.log(`${checking ? 'Checked' : 'Generated'} ${contracts.length} contracts.`)

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
  const publicLeaves = []
  const publicNames = new Set()
  const validators = []

  for (const operation of contract.operations) {
    validateOperation(operation, source)
    if (
      [...publicNames].some(
        (name) =>
          name === operation.publicName ||
          name.startsWith(operation.publicName + '.') ||
          operation.publicName.startsWith(name + '.'),
      )
    )
      throw new Error(`${source}: duplicate public name ${operation.publicName}`)
    publicNames.add(operation.publicName)
    if (contract.operations.filter((row) => row.id === operation.id).length !== 1)
      throw new Error(`${source}: duplicate operation ID ${operation.id}`)
    const name = uniqueName(pascal(operation.id), names)
    const inputSchema = combineInputSchemas(operation)
    const outputSchema = operation.output ?? {}
    // A stream row moves raw bytes: a PUT takes them in the input's `chunk`
    // field, the one the platform upload helper fills, and a GET answers them.
    const uploads = operation.stream === true && operation.method !== 'GET'
    const downloads =
      operation.bytes === true || (operation.stream === true && operation.method === 'GET')
    if (uploads) {
      inputSchema.properties.chunk = {}
      inputSchema.required.push('chunk')
    }
    const inputType = `${name}Input`
    const outputType = `${name}Output`
    const errorType = `${name}Error`
    const variable = `operation${name}`
    declarations.push(...namedDefinitions(inputSchema, inputType))
    if (!downloads) declarations.push(...namedDefinitions(outputSchema, outputType))
    declarations.push(
      `export type ${inputType} = ${schemaType(inputSchema, inputSchema)}${uploads ? ' & { chunk: Blob }' : ''}`,
    )
    declarations.push(
      `export type ${outputType} = ${downloads ? 'Blob' : schemaType(outputSchema, outputSchema)}`,
    )
    declarations.push(
      `export type ${errorType} = ${operation.errors?.length ? operation.errors.map(JSON.stringify).join(' | ') : 'never'}`,
    )
    declarations.push(`const ${variable}: ${operation.page ? 'PageRef' : operation.kind === 'query' ? 'QueryRef' : 'MutationRef'}<${inputType}, ${operation.page ? schemaType(outputSchema.properties[operation.page.rows].items, outputSchema) : outputType}, ${errorType}${operation.page ? `, ${outputType}` : ''}> = {
  id: ${JSON.stringify(operation.id)},
  owner: ${JSON.stringify(contract.owner)},
  kind: ${JSON.stringify(operation.kind)},
  publicName: ${JSON.stringify(operation.publicName)},${outputSchema.type === 'null' ? '\n  empty: true,' : ''}${operation.envelope === 'message' ? '\n  envelope: "message",' : ''}${operation.page ? `\n  page: ${JSON.stringify(operation.page)},` : ''}${downloads ? '\n  bytes: true,' : ''}
  method: ${JSON.stringify(operation.method)},
  path: ${JSON.stringify(operation.path)},
  prefix: ${JSON.stringify(contract.prefix ?? `/api/suite/${contract.owner}/`)},
  pathParams: ${JSON.stringify(operation.pathParams ?? [])},
  nodeParams: ${JSON.stringify(operation.nodeParams ?? [])},
  entity: ${JSON.stringify(operation.entity ?? null)},
  errors: ${JSON.stringify(operation.errors ?? [])},${uploads ? "\n  body: 'chunk'," : ''}
  loadValidators: async () => (await import('./validators')).${variable},
}`)
    validators.push(`export const ${variable}: Validators<${inputType}, ${outputType}> = {
      validateInput(value: unknown): asserts value is ${inputType} { assertSchema(value, ${JSON.stringify(inputSchema)}, '${operation.id} input') },
      validateOutput(value: unknown): asserts value is ${outputType} { ${downloads ? "if (!(value instanceof Blob)) throw new TypeError('Expected Blob')" : `assertSchema(value, ${JSON.stringify(outputSchema)}, '${operation.id} output')`} },
    }`)
    publicLeaves.push({ path: operation.publicName.split('.'), variable })
  }

  return {
    output: `// Generated from ${source}. Do not edit.
import type { QueryRef, MutationRef, PageRef } from '@/platform/transport'

${declarations.join('\n\n')}

export const api = ${renderApiTree(publicLeaves)} as const
`,
    validators: `// Generated from ${source}. Do not edit.
import { assertSchema } from '@/platform/transport/schema'
import type { Validators } from '@/platform/transport'
import type { ${contract.operations
      .map((operation) => {
        const name = pascal(operation.id)
        return name + 'Input, ' + name + 'Output'
      })
      .join(', ')} } from './generated'
${validators.join('\n\n')}

`,
  }
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

function namedDefinitions(schema, prefix) {
  const definitions = Object.entries(schema.$defs ?? {})
  const names = new Map(definitions.map(([key]) => [`#/$defs/${key}`, `${prefix}${pascal(key)}`]))
  schemaNames.set(schema, names)
  return definitions.map(
    ([key, definition]) =>
      `export type ${names.get(`#/$defs/${key}`)} = ${schemaType(definition, schema)}`,
  )
}

function schemaType(schema, root) {
  if (!schema || Object.keys(schema).length === 0) return 'unknown'
  if (schema.$ref)
    return (
      schemaNames.get(root)?.get(schema.$ref) ??
      schemaType(resolveSchemaRef(root, schema.$ref), root)
    )
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ') || 'never'
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.map((part) => `(${schemaType(part, root)})`).join(' | ')
  if (Array.isArray(schema.oneOf))
    return schema.oneOf.map((part) => `(${schemaType(part, root)})`).join(' | ')
  if (Array.isArray(schema.allOf))
    return schema.allOf.map((part) => `(${schemaType(part, root)})`).join(' & ')
  if (Array.isArray(schema.type))
    return schema.type.map((type) => schemaType({ ...schema, type }, root)).join(' | ')
  if (schema.type === 'array' && schema.prefixItems)
    return `[${schema.prefixItems.map((item) => schemaType(item, root)).join(', ')}]`
  if (schema.type === 'array') return `Array<${schemaType(schema.items ?? {}, root)}>`
  if (schema.type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? [])
    const fields = Object.entries(schema.properties ?? {}).map(
      ([key, child]) =>
        `${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${schemaType(child, root)}`,
    )
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      fields.push(`[key: string]: ${schemaType(schema.additionalProperties, root)}`)
    }
    if (schema.additionalProperties === true) fields.push('[key: string]: unknown')
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
  return (
    ref
      .slice(2)
      .split('/')
      .reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root) ?? {}
  )
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
  if (!['query', 'mutation'].includes(operation.kind))
    throw new Error(`${source}: ${operation.id} is missing its kind`)
  if (
    typeof operation.publicName !== 'string' ||
    !/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(operation.publicName)
  )
    throw new Error(`${source}: ${operation.id} has no valid public path`)
  if (operation.page) {
    const page = operation.page
    const input = combineInputSchemas(operation)
    const fields = input.properties ?? {}
    const result = operation.output?.properties ?? {}
    const keys = Object.keys(page).sort().join(',')
    const cursor =
      keys === 'cursor,next,rows' && fields[page.cursor]?.type === 'string' && !!result[page.next]
    const offset =
      keys === 'offset,rows,total' &&
      fields[page.offset]?.type === 'integer' &&
      result[page.total]?.type === 'integer'
    const more =
      keys === 'more,offset,rows' &&
      fields[page.offset]?.type === 'integer' &&
      result[page.more]?.type === 'boolean'
    if (
      operation.kind !== 'query' ||
      !Object.values(page).every((value) => typeof value === 'string' && value) ||
      result[page.rows]?.type !== 'array' ||
      !(cursor || offset || more)
    )
      throw new Error(`${source}: ${operation.id} has invalid page metadata`)
  }
}

function pascal(value) {
  const result = value.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_match, _separator, letter) =>
    letter.toUpperCase(),
  )
  return result || 'Operation'
}

function uniqueName(name, names) {
  let next = name
  let index = 2
  while (names.has(next)) next = `${name}${index++}`
  names.add(next)
  return next
}
